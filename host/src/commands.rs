fn props_slot_name(widget: &Widget) -> Option<String> {
    let name = widget.widget_name().to_string();
    if !name.is_empty() { Some(name) } else { None }
}
// bridge-gtk-host · command dispatch.
//
// The protocol is line-delimited JSON, one command per line. We parse each
// line into a `Command` enum and dispatch to the right widget operation.
//
// The widget registry holds a `gtk4::Widget` reference per integer id —
// the JS-side `host.create()` allocates the id and we associate a freshly-
// built GTK widget with it.
//
// `GtkWidget` from gtk4-rs is the common supertype of all widget types
// (`Box`, `Button`, `Label`, `Entry`, `Picture`, `ApplicationWindow`). We
// downcast on dispatch to call type-specific setters (e.g. `set_label`
// on a `Button`). Most property updates go through `set_property` (the
// GObject property system) which handles strings, ints, bools, floats,
// and `Option<String>` uniformly.

use std::collections::HashMap;
use std::rc::Rc;
use std::cell::{Cell, RefCell};

use glib::object::{Cast, ObjectExt};
use glib::value::ToValue;
use glib::translate::IntoGlib;
use gtk4::glib;
use gtk4::prelude::*;
use gtk4::{
    Application, ApplicationWindow, Box as GtkBox, Button, ComboBoxText, Entry, Label, Orientation,
    Picture, Stack, StackTransitionType, TextView, Widget, ScrolledWindow, WrapMode,
};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use crate::layout::Layout;

/// Top-level command. One JSON object on stdin, deserialized here.
#[derive(Debug, Deserialize)]
#[serde(tag = "cmd", rename_all = "snake_case")]
pub enum Command {
    Create {
        id: u32,
        kind: String,
        props: serde_json::Map<String, JsonValue>,
    },
    Set {
        id: u32,
        prop: String,
        value: JsonValue,
    },
    AddChild {
        parent: u32,
        child: u32,
    },
    RemoveChild {
        parent: u32,
        child: u32,
    },
    Connect {
        id: u32,
        signal: String,
        handler: u32,
    },
    Destroy { id: u32 },
    Reorder { parent: u32, children: Vec<u32> },
    Inspect { id: u32, properties: Vec<String>, request: u32 },
    Invoke { id: u32, signal: String, request: u32 },
    /// Measure the real page size for a font in a given box.
    PageMetrics { family: String, font_size: f64, width: i32, height: i32, request: u32 },
    /// Character offsets where the rendered lines break, for a chunk of text.
    LineBreaks { family: String, font_size: f64, width: i32, text: String, request: u32 },
}

/// Outbound event — one JSON object on stdout.
#[derive(Debug, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Ready,
    Result { request: u32, value: JsonValue, #[serde(skip_serializing_if = "Option::is_none")] error: Option<String> },
    Signal {
        id: u32,
        signal: String,
        handler: u32,
    },
    Change {
        /// The registered handler to call. `None` for broadcast events that
        /// every app observes through `onEvent` (file-drop, key-pressed, …).
        /// A real id of 0 would call the *first* registered handler.
        #[serde(skip_serializing_if = "Option::is_none")]
        handler: Option<u32>,
        id: u32,
        signal: String,
        value: JsonValue,
    },
    Log {
        level: LogLevel,
        message: String,
    },
    Exit {
        code: i32,
    },
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum LogLevel {
    Info,
    Warn,
    Error,
}

/// The widget registry. Maps `id → Widget` plus a typed-downcast helper.
pub struct WidgetRegistry {
    pub widgets: HashMap<u32, Widget>,
    pub updating: Rc<Cell<bool>>,
    /// Per-widget kind cache. The host uses this to disambiguate which
    /// type-specific setters to call (e.g. `set_label` only on Button/Label).
    pub kinds: HashMap<u32, String>,
    /// The single ApplicationWindow (id 1) — captured for `present` /
    /// `quit` on ready.
    pub app: Option<Application>,
    pub window: Option<ApplicationWindow>,
    pub dialogs: HashMap<u32, DialogState>,
    pub stylesheet: Option<gtk4::CssProvider>,
    /// Line spacing per widget id, as a Pango multiplier (1.0 = normal).
    pub line_heights: HashMap<u32, f32>,
    /// The text tag that carries the line spacing, per widget id.
    pub line_tags: HashMap<u32, gtk4::TextTag>,
    /// The selected value of a Select, so it survives an options rebuild.
    pub select_values: HashMap<u32, String>,
    /// Stored widget name by id, so Stack can register child slots deterministically.
    pub widget_names: HashMap<u32, String>,
    /// The visible child a Stack should show. Kept here because JS may ask for
    /// a slot before that slot is added — GTK ignores the request in that case.
    pub stack_visible: HashMap<u32, String>,
    /// Per-widget state for the native controls (Slider/Switch/Spinner/
    /// FileChooser/MenuBar). The FileChooser dialog and the menu action
    /// handler live here so later `set`/`connect` calls can reach them.
    pub control_states: HashMap<u32, crate::controls::State>,
}

pub struct DialogState {
    opener: glib::WeakRef<Widget>,
    initial_focus: Option<u32>,
    handler: Rc<Cell<u32>>,
    keys: gtk4::EventControllerKey,
}

impl WidgetRegistry {
    pub fn new() -> Self {
        Self {
            widgets: HashMap::new(),
            updating: Rc::new(Cell::new(false)),
            kinds: HashMap::new(),
            app: None,
            window: None,
            dialogs: HashMap::new(),
            stylesheet: None,
            line_heights: HashMap::new(),
            line_tags: HashMap::new(),
            select_values: HashMap::new(),
            widget_names: HashMap::new(),
            stack_visible: HashMap::new(),
            control_states: HashMap::new(),
        }
    }

    pub fn get(&self, id: u32) -> Option<&Widget> {
        self.widgets.get(&id)
    }

    #[allow(dead_code)]
    pub fn get_mut(&mut self, id: u32) -> Option<&mut Widget> {
        self.widgets.get_mut(&id)
    }
}

// ─── dispatch ────────────────────────────────────────────────────────────────

pub fn dispatch(
    cmd: Command,
    reg: &mut WidgetRegistry,
    emit: Rc<RefCell<dyn FnMut(Event)>>,
) -> Result<(), String> {
    match cmd {
        Command::Create { id, kind, props } => create(id, &kind, props, reg, emit),
        Command::Set { id, prop, value } => set_prop(id, &prop, value, reg, emit.clone()),
        Command::AddChild { parent, child } => add_child(parent, child, reg),
        Command::RemoveChild { parent, child } => remove_child(parent, child, reg),
        Command::Connect { id, signal, handler } => connect(id, &signal, handler, reg, emit),
        Command::Destroy { id } => destroy(id, reg, emit.clone()),
        Command::Reorder { parent, children } => {
            let widget = reg.get(parent).ok_or("Unknown reorder parent")?;
            if let Some(layout) = widget.downcast_ref::<Layout>() {
                let children = children.iter().map(|id| reg.get(*id).cloned().ok_or("Unknown reorder child")).collect::<Result<Vec<_>, _>>()?;
                if children.iter().any(|child| child.parent().as_ref() != Some(widget)) { return Err("Reorder children must belong to parent".into()); }
                layout.reorder(&children);
                return Ok(());
            }
            let bx = widget.downcast_ref::<GtkBox>().ok_or("Reorder parent must be Box or Layout")?;
            let focus = reg.window.as_ref().and_then(|window| gtk4::prelude::GtkWindowExt::focus(window));
            let mut previous: Option<Widget> = None;
            for id in children {
                let child = reg.get(id).ok_or("Unknown reorder child")?;
                bx.reorder_child_after(child, previous.as_ref());
                previous = Some(child.clone());
            }
            if let Some(focus) = focus { focus.grab_focus(); }
            Ok(())
        }
        Command::PageMetrics { family, font_size, width, height, request } => {
            let metrics = crate::pagination::measure(&family, font_size, width, height);
            emit.borrow_mut()(Event::Result {
                request,
                value: serde_json::json!({
                    "charsPerPage": metrics.chars_per_page(),
                    "lineHeight": metrics.line_height,
                    "lines": metrics.lines,
                }),
                error: None,
            });
            return Ok(());
        }
        Command::LineBreaks { family, font_size, width, text, request } => {
            let breaks = crate::pagination::line_breaks(&family, font_size, width, &text);
            emit.borrow_mut()(Event::Result {
                request,
                value: serde_json::json!({ "breaks": breaks }),
                error: None,
            });
            return Ok(());
        }
        Command::Inspect { id, properties, request } => {
            let result = inspect(id, properties, reg);
            let (value, error) = match result { Ok(value) => (value, None), Err(error) => (JsonValue::Null, Some(error)) };
            emit.borrow_mut()(Event::Result { request, value, error });
            Ok(())
        }
        Command::Invoke { id, signal, request } => {
            let result = reg.get(id).ok_or("Unknown widget".to_string()).and_then(|widget| {
                if signal == "dialog-escape" {
                    let state = reg.dialogs.get(&id).ok_or("dialog-escape requires a Dialog")?;
                    state.keys.emit_by_name::<bool>("key-pressed", &[&gtk4::gdk::Key::Escape.into_glib(), &0u32, &gtk4::gdk::ModifierType::empty()]);
                    return Ok(());
                }
                if signal == "dialog-dismiss" {
                    reg.dialogs.get(&id).ok_or("dialog-dismiss requires a Dialog")?;
                    widget.downcast_ref::<gtk4::Window>().unwrap().close();
                    return Ok(());
                }
                if signal == "dialog-tab" {
                    reg.dialogs.get(&id).ok_or("dialog-tab requires a Dialog")?;
                    widget.child_focus(gtk4::DirectionType::TabForward);
                    return Ok(());
                }
                if let Some(text) = signal.strip_prefix("__test_insert_text:") {
                    let entry = widget.downcast_ref::<Entry>().ok_or("Typing requires an Entry")?;
                    let mut position = entry.position();
                    entry.insert_text(text, &mut position);
                    entry.set_position(position);
                    return Ok(());
                }
                if signal == "grab_focus" { widget.grab_focus(); return Ok(()); }
                if signal == "__test_toggle" { return crate::checkbox::toggle(widget); }
                if !["clicked", "changed", "activate"].contains(&signal.as_str()) { return Err("Unsupported test signal".to_string()); }
                if (signal == "clicked" && widget.downcast_ref::<Button>().is_none()) || (signal != "clicked" && widget.downcast_ref::<Entry>().is_none()) { return Err("Signal is incompatible with widget".to_string()); }
                widget.emit_by_name::<()>(&signal, &[]);
                Ok(())
            });
            emit.borrow_mut()(Event::Result { request, value: JsonValue::Bool(result.is_ok()), error: result.err() });
            Ok(())
        }
    }
}

fn create(
    id: u32,
    kind: &str,
    props: serde_json::Map<String, JsonValue>,
    reg: &mut WidgetRegistry,
    emit: Rc<RefCell<dyn FnMut(Event)>>,
) -> Result<(), String> {
    // The host owns id 1 (the ApplicationWindow created on activate).
    // Reject any attempt by JS to overwrite it.
    if id == 1 {
        return Err("create: id 1 is reserved for the root ApplicationWindow".to_string());
    }
    let widget: Widget = match kind {
        "LayoutFlex" | "LayoutDiv" => Layout::new(kind == "LayoutFlex").upcast::<Widget>(),
        "Dialog" => {
            let dialog = gtk4::Window::builder().modal(true).hide_on_close(true)
                .accessible_role(gtk4::AccessibleRole::Dialog).default_width(360).build();
            if let Some(app) = &reg.app { dialog.set_application(Some(app)); }
            if let Some(parent) = &reg.window { dialog.set_transient_for(Some(parent)); }
            let handler = Rc::new(Cell::new(0u32));
            let close_handler = handler.clone();
            let close_emit = emit.clone();
            dialog.connect_close_request(move |_| {
                if close_handler.get() != 0 { close_emit.borrow_mut()(Event::Change { id, signal: "dialog-request".into(), handler: Some(close_handler.get()), value: JsonValue::String("dismiss".into()) }); }
                glib::Propagation::Stop
            });
            let keys = gtk4::EventControllerKey::new();
            keys.set_propagation_phase(gtk4::PropagationPhase::Capture);
            let key_handler = handler.clone();
            let key_emit = emit.clone();
            keys.connect_key_pressed(move |_, key, _, _| {
                if key == gtk4::gdk::Key::Escape {
                    if key_handler.get() != 0 { key_emit.borrow_mut()(Event::Change { id, signal: "dialog-request".into(), handler: Some(key_handler.get()), value: JsonValue::String("escape".into()) }); }
                    glib::Propagation::Stop
                } else { glib::Propagation::Proceed }
            });
            dialog.add_controller(keys.clone());
            reg.dialogs.insert(id, DialogState { opener: glib::WeakRef::new(), initial_focus: None, handler, keys });
            dialog.upcast::<Widget>()
        }
        "Window" => {
            // JS may not create additional Windows — we only support
            // one root. The existing code path would error out anyway
            // because reg.window is set, but we want a clean error.
            return Err("Window: only one root ApplicationWindow is supported (host reserves id 1)".to_string());
        }
        "Stack" => {
            let transition = match props.get("transition").and_then(|v| v.as_str()).unwrap_or("slide") {
                "crossfade" => StackTransitionType::Crossfade,
                "slide-left" => StackTransitionType::SlideLeft,
                "slide-right" => StackTransitionType::SlideRight,
                "none" => StackTransitionType::None,
                _ => StackTransitionType::SlideLeftRight,
            };
            let duration = props.get("duration").and_then(|v| v.as_u64()).unwrap_or(280) as u32;
            let stack = Stack::builder()
                .transition_type(transition)
                .transition_duration(duration)
                .hexpand(true)
                .vexpand(true)
                .build();
            stack.upcast::<Widget>()
        },
        "CheckButton" => crate::checkbox::create(&props),
        "Scroll" => {
            let scroll = ScrolledWindow::builder().hexpand(true).vexpand(true).build();
            if props.get("reportSize").and_then(|v| v.as_bool()).unwrap_or(false) {
                let emit_size = emit.clone();
                let scroll_ref = scroll.clone();
                scroll.vadjustment().connect_page_size_notify(move |adj| {
                    let (width, height) = (scroll_ref.hadjustment().page_size(), adj.page_size());
                    emit_size.borrow_mut()(Event::Change {
                        handler: None,
                        id: 0,
                        signal: "viewport-size".into(),
                        value: serde_json::json!({ "width": width, "height": height }),
                    });
                });
            }
            scroll.upcast::<Widget>()
        }
        "Slider" | "Switch" | "Spinner" | "FileChooser" | "MenuBar" => {
            let parent = reg.window.clone();
            match crate::controls::create(kind, &props, id, parent.as_ref(), emit.clone())? {
                Some((widget, state)) => {
                    reg.control_states.insert(id, state);
                    widget
                }
                None => return Err(format!("Unknown control kind: {}", kind)),
            }
        }
        "View" | "Container" => {
            let orientation = match props
                .get("orientation")
                .and_then(|v| v.as_str())
                .unwrap_or("vertical")
            {
                "horizontal" => Orientation::Horizontal,
                _ => Orientation::Vertical,
            };
            let bx = GtkBox::builder()
                .orientation(orientation)
                .spacing(props.get("spacing").and_then(|v| v.as_u64()).unwrap_or(0) as i32)
                .build();
            bx.upcast::<Widget>()
        }
        "Button" => {
            let label = props
                .get("label")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let icon = props
                .get("icon_name")
                .or_else(|| props.get("iconName"))
                .and_then(|v| v.as_str());
            let btn = Button::new();
            if let Some(icon_name) = icon {
                btn.set_icon_name(icon_name);
            }
            if !label.is_empty() || icon.is_none() {
                btn.set_label(&label);
            }
            if let Some(child) = btn.child() {
                if let Some(lbl) = child.downcast_ref::<Label>() {
                    if let Some(align) = props.get("labelAlign").and_then(|v| v.as_str()) {
                        lbl.set_ellipsize(gtk4::pango::EllipsizeMode::End);
                        lbl.set_xalign(match align {
                            "start" => 0.0,
                            "end" => 1.0,
                            _ => 0.5,
                        });
                    }
                }
            }
            btn.upcast::<Widget>()
        }
        "Text" => {
            // Both `value` and (legacy) `children` strings feed the label.
            let value = props
                .get("value")
                .and_then(|v| v.as_str())
                .or_else(|| props.get("children").and_then(|v| v.as_str()))
                .unwrap_or("")
                .to_string();
            let lbl = Label::builder().label(value).build();
            lbl.upcast::<Widget>()
        }
        "RichText" => {
            // A read-only, wrapping TextView. Books are long-form rich text:
            // headings, emphasis, selectable prose inside a ScrolledWindow.
            let view = TextView::builder()
                .editable(false)
                .cursor_visible(false)
                .wrap_mode(WrapMode::Word)
                .build();
            let buffer = view.buffer();
            if let Some(markup) = props.get("markup").and_then(|v| v.as_str()) {
                buffer.set_text("");
                let mut iter = buffer.start_iter();
                buffer.insert_markup(&mut iter, markup);
            }
            // Listen for user mouse clicks on the text (released) to jump
            // narration to the clicked sentence. We MUST NOT use buffer cursor
            // notify because inserting markup programmatically moves the cursor
            // and causes an infinite loop between host and client!
            let gesture = gtk4::GestureClick::new();
            let emit_click = emit.clone();
            let view_weak = view.downgrade();
            gesture.connect_released(move |_, _, x, y| {
                if let Some(v) = view_weak.upgrade() {
                    let (bx, by) = v.window_to_buffer_coords(gtk4::TextWindowType::Widget, x as i32, y as i32);
                    if let Some(iter) = v.iter_at_location(bx, by) {
                        let offset = iter.offset();
                        let name = v.widget_name().to_string();
                        emit_click.borrow_mut()(Event::Change {
                            handler: None,
                            id,
                            signal: "cursor-position".into(),
                            value: serde_json::json!({
                                "offset": offset,
                                "name": name,
                            }),
                        });
                    }
                }
            });
            view.add_controller(gesture);
            view.upcast::<Widget>()
        }
        "Input" => {
            let entry = Entry::builder()
                .text(props.get("value").and_then(|v| v.as_str()).unwrap_or(""))
                .placeholder_text(
                    props
                        .get("placeholder")
                        .and_then(|v| v.as_str())
                        .unwrap_or(""),
                )
                .build();
            // editable: gtk4::Entry has `editable` — mirror to enabled.
            entry.upcast::<Widget>()
        }
        "Select" => {
            // ComboBoxText (not DropDown) because it emits "changed", which
            // is the signal the bridge's generic connect already maps.
            let combo = ComboBoxText::new();
            for (value, label) in select_options(&props) {
                combo.append(Some(&value), &label);
            }
            if let Some(value) = props.get("value").and_then(|v| v.as_str()) {
                combo.set_active_id(Some(value));
            }
            combo.upcast::<Widget>()
        }
        "Icon" => gtk4::Image::new().upcast::<Widget>(),
        "Image" => {
            let pic = Picture::new();
            if let Some(src) = props.get("src").and_then(|v| v.as_str()) {
                pic.set_filename(Some(src));
            }
            pic.upcast::<Widget>()
        }
        other => {
            return Err(format!("unknown spec kind: {}", other));
        }
    };

    if let Some(name) = props.get("name").and_then(|v| v.as_str()) {
        widget.set_widget_name(name);
        reg.widget_names.insert(id, name.to_string());
    }
    // Apply the rest of the props (orientation/spacing already handled in builder).
    apply_initial_props(&widget, kind, &props, reg)?;

    reg.widgets.insert(id, widget.clone());
    reg.kinds.insert(id, kind.to_string());

    // Special-case: the first Window is also cached in reg.window
    // so the main loop can `present()` it on ready.
    if kind == "Window" {
        if let Some(window) = widget.clone().downcast::<ApplicationWindow>().ok() {
            reg.window = Some(window);
        }
    }

    Ok(())
}

fn apply_initial_props(
    widget: &Widget,
    kind: &str,
    props: &serde_json::Map<String, JsonValue>,
    _reg: &WidgetRegistry,
) -> Result<(), String> {
    // `orientation` / `spacing` / `label` / `value` / `placeholder` /
    // `src` are handled in the per-kind builder. Everything else we
    // route through `set_property` (GObject).
    for (k, v) in props.iter() {
        // Native controls apply their own props — GTK has no such
        // GObject properties (Scale has no "min", Button has no "open").
        if crate::controls::owns(kind, k) {
            continue;
        }
        match k.as_str() {
            "orientation" | "spacing" | "label" | "value" | "placeholder" | "src" | "children" | "markup" | "options" | "labelAlign" | "transition" | "duration" | "visibleChild" | "visible_child" | "scrollToChar" | "scroll_to_char" | "scrollIntoView" | "resetScroll" | "reportSize" | "open" => continue,
            _ => {
                set_property_typed(widget, k, v)?;
            }
        }
    }
    Ok(())
}

/// Read the options of a Select: a list of {value, label} pairs.
fn select_options(props: &serde_json::Map<String, JsonValue>) -> Vec<(String, String)> {
    props
        .get("options")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let obj = item.as_object()?;
                    let value = obj.get("value")?.as_str()?.to_string();
                    let label = obj.get("label").and_then(|v| v.as_str()).unwrap_or(&value).to_string();
                    Some((value, label))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Replace the whole content of a TextView with Pango markup.
///
/// Pango rejects the WHOLE string when one attribute is invalid (for
/// example `indent` on a `<span>`), which would leave the page blank.
/// The markup is therefore parsed first; on failure the previous text is
/// kept and the problem is reported.
fn set_text_markup(view: &TextView, markup: &str) -> Result<(), String> {
    if let Err(error) = gtk4::pango::parse_markup(markup, ' ') {
        return Err(format!("Pango rejeitou o markup: {error}"));
    }
    let buffer = view.buffer();
    buffer.set_text("");
    let mut iter = buffer.start_iter();
    buffer.insert_markup(&mut iter, markup);
    Ok(())
}

/// Apply a line-spacing tag to the whole buffer. GTK CSS has no
/// `line-height`, and Pango markup has no line spacing either — the only
/// native way is a text tag on the buffer.
fn apply_line_height(view: &TextView, tags: &mut HashMap<u32, gtk4::TextTag>, id: u32, multiplier: f32) {
    if multiplier <= 0.0 { return; }
    let buffer = view.buffer();
    let tag = match tags.get(&id) {
        Some(tag) => tag.clone(),
        None => {
            let tag = gtk4::TextTag::new(Some("nandomo-line-height"));
            tag.set_property("line-height", multiplier);
            buffer.tag_table().add(&tag);
            tags.insert(id, tag.clone());
            tag
        }
    };
    tag.set_property("line-height", multiplier);
    let start = buffer.start_iter();
    let end = buffer.end_iter();
    buffer.apply_tag(&tag, &start, &end);
}

fn set_prop(
    id: u32,
    prop: &str,
    value: JsonValue,
    reg: &mut WidgetRegistry,
    emit: Rc<RefCell<dyn FnMut(Event)>>,
) -> Result<(), String> {    // Native controls own their props (Slider range, Switch active, …).
    if let Some(kind) = reg.kinds.get(&id).cloned() {
        if crate::controls::owns(&kind, prop) {
            let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
            let state = reg.control_states.get(&id);
            // A programmatic binding update is not a user edit.
            let previous = reg.updating.replace(true);
            let result = crate::controls::set(&widget, state, prop, &value, id, emit.clone());
            reg.updating.set(previous);
            if let Some(result) = result {
                return result;
            }
        }
    }
    if prop == "styleSheet" {
        let widget = reg.get(id).ok_or("Unknown stylesheet window")?.clone();
        if widget.downcast_ref::<gtk4::Window>().is_none() { return Err("styleSheet requires Window".into()); }
        crate::appearance::stylesheet(&widget, value.as_str().ok_or("styleSheet must be string")?, &mut reg.stylesheet);
        return Ok(());
    }
    if prop == "scrollIntoView" {
        let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
        if value.as_bool().ok_or("scrollIntoView must be boolean")? { scroll_into_view(widget, 20); }
        return Ok(());
    }
    if prop == "resetScroll" {
        let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
        if let Ok(view) = widget.downcast::<TextView>() {
            if let Some(adjustment) = view.vadjustment() {
                adjustment.set_value(0.0);
            }
        }
        return Ok(());
    }
    if prop == "scrollToChar" || prop == "scroll_to_char" {
        let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
        if let Ok(view) = widget.downcast::<TextView>() {
            if let Some(offset) = value.as_i64() {
                let view_clone = view.clone();
                let char_offset = offset.max(0) as i32;
                let buffer = view.buffer();
                let mut iter = buffer.iter_at_offset(char_offset);
                view.scroll_to_iter(&mut iter, 0.12, true, 0.0, 0.35);

                glib::idle_add_local_once(move || {
                    let buffer = view_clone.buffer();
                    let mut iter = buffer.iter_at_offset(char_offset);
                    view_clone.scroll_to_iter(&mut iter, 0.12, true, 0.0, 0.35);
                });
                return Ok(());
            }
        }
    }
    if prop == "markup" {
        let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
        if let Ok(view) = widget.downcast::<TextView>() {
            let markup = value.as_str().ok_or("markup must be string")?;
            set_text_markup(&view, markup)?;
            let height = reg.line_heights.get(&id).copied().unwrap_or(0.0);
            apply_line_height(&view, &mut reg.line_tags, id, height);
            return Ok(());
        }
    }
    if prop == "options" {
        let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
        if let Ok(combo) = widget.downcast::<ComboBoxText>() {
            combo.remove_all();
            for item in value.as_array().map(|items| items.as_slice()).unwrap_or(&[]) {
                let obj = item.as_object();
                let option = obj
                    .and_then(|o| o.get("value"))
                    .and_then(|v| v.as_str())
                    .unwrap_or_default()
                    .to_string();
                let label = obj
                    .and_then(|o| o.get("label"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(option.as_str())
                    .to_string();
                combo.append(Some(&option), &label);
            }
            // Rebuilding the list drops the selection — put it back.
            if let Some(current) = reg.select_values.get(&id).cloned() {
                combo.set_active_id(Some(&current));
            }
            return Ok(());
        }
    }
    if prop == "value" {
        if let Some(text) = value.as_str() {
            let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
            if let Ok(combo) = widget.downcast::<ComboBoxText>() {
                reg.select_values.insert(id, text.to_string());
                combo.set_active_id(Some(text));
                return Ok(());
            }
        }
    }
    if prop == "visibleChild" || prop == "visible_child" {
        let stack = reg.get(id).and_then(|w| w.downcast_ref::<Stack>()).cloned();
        if let Some(stack) = stack {
            let name = if let Some(name) = value.as_str() {
                Some(name.to_string())
            } else {
                value.as_u64().map(|child_id| format!("child_{}", child_id))
            };
            if let Some(name) = name {
                // Remember it: the matching slot may still be on its way.
                let exists = stack.child_by_name(&name).is_some();
                reg.stack_visible.insert(id, name.clone());
                if exists {
                    stack.set_visible_child_name(&name);
                }
                return Ok(());
            }
        }
    }
    if prop == "transition" {
        if let Some(stack) = reg.get(id).and_then(|w| w.downcast_ref::<Stack>()) {
            let t = match value.as_str().unwrap_or("slide") {
                "crossfade" => StackTransitionType::Crossfade,
                "slide-left" => StackTransitionType::SlideLeft,
                "slide-right" => StackTransitionType::SlideRight,
                "none" => StackTransitionType::None,
                _ => StackTransitionType::SlideLeftRight,
            };
            stack.set_transition_type(t);
            return Ok(());
        }
    }
    if prop == "lineHeight" {
        let widget = reg.get(id).ok_or_else(|| format!("set on unknown widget id {}", id))?.clone();
        if let Ok(view) = widget.downcast::<TextView>() {
            // Pango expresses line spacing as a multiplier (1.0 = the
            // font's natural spacing).
            let multiplier = value.as_f64().unwrap_or(1.0) as f32;
            reg.line_heights.insert(id, multiplier);
            apply_line_height(&view, &mut reg.line_tags, id, multiplier);
            return Ok(());
        }
    }
    if let Some(layout) = reg.get(id).and_then(|widget| widget.downcast_ref::<Layout>()) {
        if ["direction", "gap", "align", "justify", "grow", "width", "height"].contains(&prop) {
            return layout.set_layout_prop(prop, value);
        }
    }
    if reg.dialogs.contains_key(&id) {
        if prop == "initial-focus" {
            reg.dialogs.get_mut(&id).unwrap().initial_focus = value.as_u64().map(|id| id as u32);
            return Ok(());
        }
        if prop == "open" {
            let dialog = reg.get(id).unwrap().clone().downcast::<gtk4::Window>().unwrap();
            let open = value.as_bool().ok_or("Dialog.open must be boolean")?;
            if open == dialog.is_visible() { return Ok(()); }
            if open {
                let opener = dialog.transient_for().and_then(|parent| gtk4::prelude::GtkWindowExt::focus(&parent));
                reg.dialogs.get_mut(&id).unwrap().opener.set(opener.as_ref());
                dialog.present();
                if let Some(focus) = reg.dialogs.get(&id).and_then(|state| state.initial_focus).and_then(|id| reg.get(id)) {
                    if focus.is_ancestor(&dialog) { focus.grab_focus(); }
                }
            } else {
                dialog.set_visible(false);
                if let Some(opener) = reg.dialogs.get(&id).unwrap().opener.upgrade() {
                    if opener.is_visible() && opener.is_sensitive() { opener.grab_focus(); }
                }
                reg.dialogs.get_mut(&id).unwrap().opener.set(None::<&Widget>);
            }
            return Ok(());
        }
    }
    let widget = reg
        .get(id)
        .ok_or_else(|| format!("set on unknown widget id {}", id))?;
    // A programmatic binding update is not a user edit. Entry.set_text can
    // emit an intermediate empty changed signal followed by the final text.
    let previous = reg.updating.replace(true);
    let result = set_property_typed(widget, prop, &value);
    reg.updating.set(previous);
    result
}

/// Apply a JSON value to a widget property. We try a sequence of type
/// conversions in order of common-ness:
///   • bool → bool (when prop name is in a known bool set or value is
///     clearly bool)
///   • string → String / Option<GString>
///   • integer → i32 / u32 / f64
fn set_property_typed(widget: &Widget, prop: &str, value: &JsonValue) -> Result<(), String> {
    if let Some(result) = crate::appearance::set(widget, prop, value) { return result; }
    if let Some(result) = crate::accessibility::set(widget, prop, value) { return result; }
    // Translate a few known widget properties to type-specific setters
    // so we don't have to fish through GObject's property system. These
    // are the properties every bridge primitive declares.
    match (prop, value) {
        ("duration" | "transitionDuration" | "transition_duration", JsonValue::Number(n)) => {
            if let Some(stack) = widget.downcast_ref::<Stack>() {
                stack.set_transition_duration(n.as_u64().unwrap_or(280) as u32);
                return Ok(());
            }
        }
        ("transition", JsonValue::String(s)) => {
            if let Some(stack) = widget.downcast_ref::<Stack>() {
                let t = match s.as_str() {
                    "crossfade" => StackTransitionType::Crossfade,
                    "slide-left" => StackTransitionType::SlideLeft,
                    "slide-right" => StackTransitionType::SlideRight,
                    "none" => StackTransitionType::None,
                    _ => StackTransitionType::SlideLeftRight,
                };
                stack.set_transition_type(t);
                return Ok(());
            }
        }
        ("visibleChild" | "visible_child", JsonValue::String(s)) => {
            if let Some(stack) = widget.downcast_ref::<Stack>() {
                stack.set_visible_child_name(s);
                return Ok(());
            }
        }
        ("name", JsonValue::String(s)) => {
            widget.set_widget_name(s);
            return Ok(());
        }
        ("label", JsonValue::String(s)) => {
            if let Some(checkbox) = widget.downcast_ref::<gtk4::CheckButton>() {
                checkbox.set_label(Some(s));
                return Ok(());
            }
            if let Ok(btn) = widget.clone().downcast::<Button>() {
                btn.set_label(s);
                return Ok(());
            }
            if let Ok(lbl) = widget.clone().downcast::<Label>() {
                lbl.set_label(s);
                return Ok(());
            }
        }
        ("icon_name" | "iconName", JsonValue::String(s)) => {
            if let Some(btn) = widget.downcast_ref::<Button>() {
                btn.set_icon_name(s);
                return Ok(());
            }
            if let Some(image) = widget.downcast_ref::<gtk4::Image>() {
                image.set_icon_name(Some(s));
                return Ok(());
            }
        }
        ("labelAlign", JsonValue::String(s)) => {
            if let Some(btn) = widget.downcast_ref::<Button>() {
                if btn.child().is_none() {
                    btn.set_label("");
                }
                if let Some(child) = btn.child() {
                    if let Some(lbl) = child.downcast_ref::<Label>() {
                        lbl.set_ellipsize(gtk4::pango::EllipsizeMode::End);
                        lbl.set_xalign(match s.as_str() {
                            "start" => 0.0,
                            "end" => 1.0,
                            _ => 0.5,
                        });
                    }
                }
            }
            return Ok(());
        }
        ("xalign", JsonValue::Number(n)) => {
            if let Some(label) = widget.downcast_ref::<Label>() {
                let align = n.as_f64().ok_or("Invalid label alignment")?;
                if !(0.0..=1.0).contains(&align) { return Err("Label alignment must be between 0 and 1".into()); }
                label.set_xalign(align as f32);
                return Ok(());
            }
        }
        ("cursorPosition", JsonValue::Number(position)) => {
            if let Some(entry) = widget.downcast_ref::<Entry>() {
                entry.set_position(position.as_i64().ok_or("Invalid cursor position")?.try_into().map_err(|_| "Cursor position out of range")?);
                return Ok(());
            }
        }
        ("text" | "value", JsonValue::String(s)) => {
            if let Ok(entry) = widget.clone().downcast::<Entry>() {
                // The user edit already changed native text. Echoing it resets
                // GtkEditable's caret and selection even when the value is equal.
                if entry.text().as_str() != s {
                    let position = entry.position();
                    let selection = entry.selection_bounds();
                    entry.set_text(s);
                    let length = s.chars().count().min(i32::MAX as usize) as i32;
                    if let Some((start, end)) = selection {
                        entry.select_region(start.min(length), end.min(length));
                    } else {
                        entry.set_position(position.min(length));
                    }
                }
                return Ok(());
            }
            if let Ok(lbl) = widget.clone().downcast::<Label>() {
                lbl.set_text(s);
                return Ok(());
            }
            if let Ok(btn) = widget.clone().downcast::<Button>() {
                btn.set_label(s);
                return Ok(());
            }
        }
        ("markup", JsonValue::String(s)) => {
            if let Ok(view) = widget.clone().downcast::<TextView>() {
                // GtkTextView has no set_markup — markup goes through the
                // buffer. Clear it first so a re-render replaces the text
                // instead of appending to it.
                let buffer = view.buffer();
                buffer.set_text("");
                let mut iter = buffer.start_iter();
                buffer.insert_markup(&mut iter, s);
                return Ok(());
            }
        }
        ("wrap", JsonValue::String(s)) => {
            if let Ok(view) = widget.clone().downcast::<TextView>() {
                view.set_wrap_mode(match s.as_str() {
                    "none" => WrapMode::None,
                    "char" => WrapMode::Char,
                    _ => WrapMode::Word,
                });
                return Ok(());
            }
        }
        ("editable", JsonValue::Bool(b)) => {
            if let Ok(view) = widget.clone().downcast::<TextView>() {
                view.set_editable(*b);
                return Ok(());
            }
        }
        ("justify", JsonValue::String(s)) => {
            if let Ok(view) = widget.clone().downcast::<TextView>() {
                view.set_justification(match s.as_str() {
                    "right" => gtk4::Justification::Right,
                    "center" => gtk4::Justification::Center,
                    "fill" => gtk4::Justification::Fill,
                    _ => gtk4::Justification::Left,
                });
                return Ok(());
            }
        }
        ("placeholder", JsonValue::String(s)) => {
            if let Ok(entry) = widget.clone().downcast::<Entry>() {
                entry.set_placeholder_text(Some(s));
                return Ok(());
            }
        }
        ("placeholder_text", JsonValue::String(s)) => {
            if let Ok(entry) = widget.clone().downcast::<Entry>() {
                entry.set_placeholder_text(Some(s));
                return Ok(());
            }
        }
        ("src", JsonValue::String(s)) => {
            if let Ok(pic) = widget.clone().downcast::<Picture>() {
                pic.set_filename(Some(s));
                return Ok(());
            }
        }
        ("spacing", JsonValue::Number(n)) => {
            if let Some(bx) = widget.clone().downcast::<GtkBox>().ok() {
                bx.set_spacing(n.as_i64().unwrap_or(0) as i32);
                return Ok(());
            }
        }
        ("orientation", JsonValue::String(s)) => {
            if let Some(bx) = widget.clone().downcast::<GtkBox>().ok() {
                bx.set_orientation(match s.as_str() {
                    "horizontal" => Orientation::Horizontal,
                    _ => Orientation::Vertical,
                });
                return Ok(());
            }
        }
        ("title", JsonValue::String(s)) => {
            if let Some(win) = widget.clone().downcast::<gtk4::Window>().ok() {
                win.set_title(Some(s));
                return Ok(());
            }
        }
        ("default_width", JsonValue::Number(n)) => {
            if let Some(win) = widget.clone().downcast::<ApplicationWindow>().ok() {
                win.set_default_width(n.as_i64().unwrap_or(0) as i32);
                return Ok(());
            }
        }
        ("default_height", JsonValue::Number(n)) => {
            if let Some(win) = widget.clone().downcast::<ApplicationWindow>().ok() {
                win.set_default_height(n.as_i64().unwrap_or(0) as i32);
                return Ok(());
            }
        }
        ("visible", JsonValue::Bool(b)) => {
            widget.set_visible(*b);
            return Ok(());
        }
        ("disabled", JsonValue::Bool(b)) => {
            widget.set_sensitive(!*b);
            return Ok(());
        }
        _ => {}
    }

    // Generic GObject property setter for everything else. This is the
    // fall-through; gtk4-rs's `set_property` accepts a `&ToValue` and
    // does the type coercion internally.
    if widget.find_property(prop).is_none() { return Err(format!("Unknown GTK property: {}", prop)); }
    let gvalue = json_to_gvalue(value);
    widget.set_property(prop, gvalue);
    Ok(())
}

fn json_to_gvalue(v: &JsonValue) -> glib::Value {
    match v {
        JsonValue::Null => None::<String>.to_value(),
        JsonValue::Bool(b) => b.to_value(),
        JsonValue::Number(n) => {
            if let Some(i) = n.as_i64() {
                (i as i32).to_value()
            } else if let Some(f) = n.as_f64() {
                f.to_value()
            } else {
                0i32.to_value()
            }
        }
        JsonValue::String(s) => s.to_value(),
        _ => v.to_string().to_value(),
    }
}

fn add_child(parent: u32, child: u32, reg: &mut WidgetRegistry) -> Result<(), String> {
    // Take the parent out of the registry briefly so we can downcast
    // without fighting the borrow checker. The widget stays alive
    // (Widget is reference-counted via GObject).
    let parent_widget = reg
        .get(parent)
        .ok_or_else(|| format!("add_child: unknown parent id {}", parent))?
        .clone();
    let child_widget = reg
        .get(child)
        .ok_or_else(|| format!("add_child: unknown child id {}", child))?
        .clone();

    if reg.dialogs.contains_key(&child) {
        let dialog = child_widget.downcast_ref::<gtk4::Window>().unwrap();
        let parent_window = parent_widget.root().and_then(|root| root.downcast::<gtk4::Window>().ok())
            .or_else(|| parent_widget.clone().downcast::<gtk4::Window>().ok());
        if let Some(window) = parent_window { dialog.set_transient_for(Some(&window)); }
        return Ok(());
    }
    if let Some(layout) = parent_widget.downcast_ref::<Layout>() { layout.append(&child_widget); return Ok(()); }
    if let Some(bx) = parent_widget.downcast_ref::<GtkBox>() {
        bx.append(&child_widget);
        return Ok(());
    }
    if let Some(button) = parent_widget.downcast_ref::<Button>() {
        button.set_child(Some(&child_widget));
        return Ok(());
    }
    if let Some(stack) = parent_widget.downcast_ref::<Stack>() {
        let name = reg.widget_names.get(&child).cloned().unwrap_or_else(|| format!("child_{}", child));
        stack.add_named(&child_widget, Some(&name));
        // JS often asks for the visible slot before the slot exists (the
        // function-prop effects run before children are mounted). GTK ignores
        // that request, so re-apply it now that the child is really there.
        if let Some(wanted) = reg.stack_visible.get(&parent) {
            if wanted == &name {
                stack.set_visible_child_name(&name);
            }
        }
        return Ok(());
    }
    if let Some(stack) = parent_widget.downcast_ref::<Stack>() {
        stack.remove(&child_widget);
        return Ok(());
    }
    if let Some(scroll) = parent_widget.downcast_ref::<ScrolledWindow>() {
        scroll.set_child(Some(&child_widget));
        return Ok(());
    }
    if let Some(win) = parent_widget.downcast_ref::<gtk4::Window>() {
        // An ApplicationWindow isn't a container — but GTK accepts
        // arbitrary widgets as the window content via `set_child`.
        win.set_child(Some(&child_widget));
        return Ok(());
    }
    Err(format!(
        "add_child: parent id {} is not a container (kind: {})",
        parent,
        reg.kinds.get(&parent).cloned().unwrap_or_else(|| "?".to_string())
    ))
}

fn remove_child(parent: u32, child: u32, reg: &mut WidgetRegistry) -> Result<(), String> {
    let parent_widget = reg
        .get(parent)
        .ok_or_else(|| format!("remove_child: unknown parent id {}", parent))?
        .clone();
    let child_widget = reg
        .get(child)
        .ok_or_else(|| format!("remove_child: unknown child id {}", child))?
        .clone();

    if let Some(layout) = parent_widget.downcast_ref::<Layout>() { layout.remove(&child_widget); return Ok(()); }
    if let Some(bx) = parent_widget.downcast_ref::<GtkBox>() {
        bx.remove(&child_widget);
        return Ok(());
    }
    if let Some(button) = parent_widget.downcast_ref::<Button>() {
        if button.child().as_ref() == Some(&child_widget) { button.set_child(None::<&Widget>); }
        return Ok(());
    }
    if let Some(stack) = parent_widget.downcast_ref::<Stack>() {
        // Removing a slot must remove it. Re-adding it would duplicate the
        // slot name and leave the stack with a dead child.
        stack.remove(&child_widget);
        return Ok(());
    }
    if let Some(scroll) = parent_widget.downcast_ref::<ScrolledWindow>() {
        if scroll.child().as_ref() == Some(&child_widget) { scroll.set_child(None::<&Widget>); }
        return Ok(());
    }
    if let Some(win) = parent_widget.downcast_ref::<ApplicationWindow>() {
        // Clear the child if it matches.
        if let Some(existing) = win.child() {
            if existing == child_widget {
                win.set_child(None::<&gtk4::Widget>);
            }
        }
        return Ok(());
    }
    Err(format!(
        "remove_child: parent id {} is not a container (kind: {})",
        parent,
        reg.kinds.get(&parent).cloned().unwrap_or_else(|| "?".to_string())
    ))
}

fn connect(
    id: u32,
    signal: &str,
    handler: u32,
    reg: &mut WidgetRegistry,
    emit: Rc<RefCell<dyn FnMut(Event)>>,
) -> Result<(), String> {
    if signal == "dialog-request" {
        reg.dialogs.get(&id).ok_or("dialog-request requires a Dialog")?.handler.set(handler);
        return Ok(());
    }
    let widget = reg
        .get(id)
        .ok_or_else(|| format!("connect: unknown widget id {}", id))?
        .clone();

    // Map nandomo's signal names to GTK signal names. The JS bridge
    // already maps onTap→clicked / onChange→changed; this is the
    // second-layer mapping for any signals that need GTK-specific
    // names.
    let gtk_signal = match signal {
        "clicked" => "clicked",
        "changed" => "changed",
        "activate" => "activate",
        "submit" => "activate",
        other => other,
    };

    let updating = reg.updating.clone();
    if gtk_signal == "toggled" {
        return crate::checkbox::connect(&widget, id, handler, updating, emit);
    }
    if let Some(kind) = reg.kinds.get(&id).cloned() {
        if crate::controls::is_control(&kind) {
            let state = reg.control_states.get(&id);
            if let Some(result) = crate::controls::connect(&widget, state, id, &gtk_signal, handler, updating.clone(), emit.clone()) {
                return result;
            }
        }
    }
    let handler_id = handler;
    let emit_for_handler = emit.clone();
    // Capture an FnMut shim in an Rc<RefCell<>> so GTK callbacks (Fn)
    // can borrow it through interior mutability.
    let emit_cell: Rc<RefCell<dyn FnMut(Event)>> = emit.clone();

    // We connect to whichever GTK signal the widget supports.
    // The dispatch logic matches the bridge-gtk event mapping.
    match (gtk_signal, widget.clone().downcast::<Button>().ok().is_some()) {
        ("clicked", true) => {
            let id_for_handler = id;
            let emit_for_cb = emit_for_handler.clone();
            widget.connect_local("clicked", false, move |_| {
                let ev = Event::Signal {
                    id: id_for_handler,
                    signal: "clicked".to_string(),
                    handler: handler_id,
                };
                emit_for_cb.borrow_mut()(ev);
                None
            });
        }
        _ => {
            // Generic fallback — connect_local with the raw signal name.
            // GTK panics if the signal name is unknown; we wrap in
            // std::panic::catch_unwind to surface the failure as a log
            // event instead of taking the whole host down.
            let sname = gtk_signal.to_string();
            let sname_for_handler = sname.clone();
            let id_for_handler = id;
            let emit_for_signal = emit_cell.clone();
            let connect_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                widget.connect_local(gtk_signal, false, move |args| {
                    if updating.get() { return None; }
                    let ev = if sname_for_handler == "changed" {
                        if let Ok(entry) = args[0].get::<Entry>() {
                            let text = entry.text().to_string();
                            Event::Change {
                                handler: Some(handler_id),
                                id: id_for_handler,
                                signal: "changed".to_string(),
                                value: JsonValue::String(text),
                            }
                        } else if let Ok(combo) = args[0].get::<ComboBoxText>() {
                            let text = combo.active_id().unwrap_or_default().to_string();
                            Event::Change {
                                handler: Some(handler_id),
                                id: id_for_handler,
                                signal: "changed".to_string(),
                                value: JsonValue::String(text),
                            }
                        } else {
                            Event::Signal {
                                id: id_for_handler,
                                signal: "changed".to_string(),
                                handler: handler_id,
                            }
                        }
                    } else {
                        Event::Signal {
                            id: id_for_handler,
                            signal: sname_for_handler.to_string(),
                            handler: handler_id,
                        }
                    };
                    emit_for_signal.borrow_mut()(ev);
                    None
                })
            }));
            if connect_result.is_err() {
                emit.borrow_mut()(Event::Log {
                    level: LogLevel::Warn,
                    message: format!(
                        "connect_local rejected unknown signal {} on widget {}",
                        sname, id
                    ),
                });
            }
        }
    }
    Ok(())
}

fn destroy(id: u32, reg: &mut WidgetRegistry, emit: Rc<RefCell<dyn FnMut(Event)>>) -> Result<(), String> {
    if reg.dialogs.contains_key(&id) {
        set_prop(id, "open", JsonValue::Bool(false), reg, emit.clone())?;
        if let Some(window) = reg.get(id).and_then(|widget| widget.downcast_ref::<gtk4::Window>()) { window.destroy(); }
        reg.dialogs.remove(&id);
    }
    if let Some(w) = reg.widgets.remove(&id) {
        // If this was the window, also quit the app.
        if let Some(win) = reg.window.as_ref() {
            if win == &w {
                if let Some(app) = reg.app.as_ref() {
                    app.quit();
                }
            }
        }
        // Drop the widget — GTK finalizes it.
        drop(w);
    }
    reg.kinds.remove(&id);
    Ok(())
}
fn inspect(id: u32, properties: Vec<String>, reg: &WidgetRegistry) -> Result<JsonValue, String> {
    let widget = reg.get(id).ok_or("Unknown widget")?;
    let mut result = serde_json::Map::new();
    for property in properties {
        let value = match property.as_str() {
            "parent" => widget.parent().and_then(|parent| reg.widgets.iter().find(|(_, candidate)| **candidate == parent).map(|(id, _)| JsonValue::from(*id))).unwrap_or(JsonValue::Null),
            "vexpand" => JsonValue::Bool(widget.compute_expand(Orientation::Vertical)),
            "hexpand" => JsonValue::Bool(widget.compute_expand(Orientation::Horizontal)),
            "kind" => JsonValue::String(reg.kinds.get(&id).cloned().unwrap_or_default()),
            "active" => crate::checkbox::active(widget),
            "cursorPosition" => widget.downcast_ref::<Entry>().map(|entry| JsonValue::from(entry.position())).unwrap_or(JsonValue::Null),
            "text" => {
                if let Some(entry) = widget.downcast_ref::<Entry>() { JsonValue::String(entry.text().to_string()) }
                else if let Some(label) = widget.downcast_ref::<Label>() { JsonValue::String(label.text().to_string()) }
                else if let Some(button) = widget.downcast_ref::<Button>() { JsonValue::String(button.label().unwrap_or_default().to_string()) }
                else { JsonValue::Null }
            }
            "children" => {
                let mut ids = Vec::new();
                let mut child = widget.first_child();
                while let Some(current) = child {
                    if let Some((id, _)) = reg.widgets.iter().find(|(_, candidate)| *candidate == &current) { ids.push(*id); }
                    child = current.next_sibling();
                }
                serde_json::to_value(ids).unwrap()
            }
            "exists" => JsonValue::Bool(true),
            "identity" => JsonValue::from(id),
            "position" => {
                let mut position = 0;
                let mut sibling = widget.parent().and_then(|parent| parent.prev_sibling());
                while let Some(previous) = sibling { position += 1; sibling = previous.prev_sibling(); }
                JsonValue::from(position)
            }
            "sensitive" => JsonValue::Bool(widget.is_sensitive()),
            "focused" => JsonValue::Bool(widget.root().and_then(|root| root.downcast::<gtk4::Window>().ok()).and_then(|window| gtk4::prelude::GtkWindowExt::focus(&window)).map(|focus| focus == *widget || focus.is_ancestor(widget)).unwrap_or(false)),
            "title" => widget.downcast_ref::<gtk4::Window>().map(|window| JsonValue::String(window.title().unwrap_or_default().to_string())).unwrap_or(JsonValue::Null),
            "modal" => JsonValue::Bool(widget.downcast_ref::<gtk4::Window>().map(|window| window.is_modal()).unwrap_or(false)),
            "visible" => JsonValue::Bool(widget.is_visible()),
            "width" => JsonValue::from(widget.width()),
            "height" => JsonValue::from(widget.height()),
            "x" | "y" => {
                let bounds = widget.parent().and_then(|parent| widget.compute_bounds(&parent));
                JsonValue::from(bounds.map(|bounds| if property == "x" { bounds.x() } else { bounds.y() }).unwrap_or(0.0))
            }
            "layout" => widget.downcast_ref::<Layout>().map(Layout::resolved).unwrap_or(JsonValue::Null),
            "registrySize" => JsonValue::from(reg.widgets.len()),
            _ => return Err(format!("Unsupported inspection property: {}", property)),
        };
        result.insert(property, value);
    }
    Ok(JsonValue::Object(result))
}

/// Scroll the nearest Viewport so `widget` is visible. The widget may not be
/// allocated yet (just created, or inside a hidden sidebar), so retry briefly.
fn scroll_into_view(widget: Widget, tries: u32) {
    glib::timeout_add_local_once(std::time::Duration::from_millis(60), move || {
        if widget.is_mapped() && widget.width() > 0 {
            if let Some(viewport) = widget.ancestor(gtk4::Viewport::static_type()).and_then(|w| w.downcast::<gtk4::Viewport>().ok()) {
                viewport.scroll_to(&widget, None);
                return;
            }
        }
        if tries > 0 { scroll_into_view(widget, tries - 1); }
    });
}
