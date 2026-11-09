//! Native controls. Parsing helpers are display-independent so boundary checks run headlessly.
use std::{cell::{Cell, RefCell}, collections::HashSet, rc::Rc};
use gtk4::{glib, gio, prelude::*, Widget};
use serde::Deserialize;
use serde_json::{Value, Map, json};
use crate::commands::Event;

type Emit = Rc<RefCell<dyn FnMut(Event)>>;
pub struct State {
    handler: Rc<Cell<u32>>,
    chooser: Option<gtk4::FileChooserNative>,
}
impl Drop for State {
    fn drop(&mut self) { if let Some(dialog) = &self.chooser { dialog.destroy(); } }
}
fn number(value: &Value) -> Result<f64, String> {
    value.as_f64().filter(|n| n.is_finite()).ok_or("Expected finite number".into())
}
fn boolean(value: &Value) -> Result<bool, String> { value.as_bool().ok_or("Expected boolean".into()) }
fn text(value: &Value) -> Result<&str, String> { value.as_str().filter(|s| !s.contains('\0')).ok_or("Expected string without NUL".into()) }
fn orientation(value: &Value) -> Result<gtk4::Orientation, String> {
    match text(value)? { "horizontal" => Ok(gtk4::Orientation::Horizontal), "vertical" => Ok(gtk4::Orientation::Vertical), _ => Err("Invalid Slider.orientation".into()) }
}
fn range(min: f64, max: f64, step: f64, value: f64) -> Result<(), String> {
    if [min, max, step, value].iter().any(|v| !v.is_finite()) || min >= max || step <= 0.0 || !(min..=max).contains(&value) {
        return Err("Slider requires finite min < max, step > 0 and min <= value <= max".into());
    }
    Ok(())
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct MenuItem {
    label: String,
    #[serde(default)] id: Option<String>,
    #[serde(default)] disabled: bool,
    #[serde(default)] items: Vec<MenuItem>,
}
fn menu_items(value: &Value) -> Result<Vec<MenuItem>, String> {
    let items: Vec<MenuItem> = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    fn check(items: &[MenuItem], depth: usize, count: &mut usize, ids: &mut HashSet<String>) -> Result<(), String> {
        if depth > 16 { return Err("Menu nesting exceeds 16".into()); }
        for item in items {
            *count += 1;
            if *count > 1000 || item.label.contains('\0') || item.label.is_empty() { return Err("Invalid menu label or menu exceeds 1000 items".into()); }
            if item.items.is_empty() {
                let id = item.id.as_ref().filter(|s| !s.is_empty() && !s.contains('\0')).ok_or("Menu leaf requires id")?;
                if !ids.insert(id.clone()) { return Err("Menu ids must be unique".into()); }
            } else {
                if item.id.is_some() { return Err("Submenus cannot have action ids".into()); }
                check(&item.items, depth + 1, count, ids)?;
            }
        }
        Ok(())
    }
    check(&items, 0, &mut 0, &mut HashSet::new())?;
    Ok(items)
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct Filter {
    name: String,
    #[serde(default)] patterns: Vec<String>,
    #[serde(default, rename = "mimeTypes")] mime_types: Vec<String>,
}
fn filters(value: &Value) -> Result<Vec<Filter>, String> {
    let filters: Vec<Filter> = serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
    if filters.len() > 100 { return Err("Too many file filters".into()); }
    for f in &filters {
        if f.name.is_empty() || f.patterns.len() + f.mime_types.len() == 0 || f.patterns.len() + f.mime_types.len() > 100 || std::iter::once(&f.name).chain(f.patterns.iter()).chain(f.mime_types.iter()).any(|s| s.is_empty() || s.contains('\0')) {
            return Err("Invalid file filter".into());
        }
    }
    Ok(filters)
}
fn action(value: &Value) -> Result<gtk4::FileChooserAction, String> {
    match text(value)? { "open" => Ok(gtk4::FileChooserAction::Open), "save" => Ok(gtk4::FileChooserAction::Save), "select-folder" => Ok(gtk4::FileChooserAction::SelectFolder), _ => Err("Invalid FileChooser.action".into()) }
}
/// True for the kinds this module owns.
pub fn is_control(kind: &str) -> bool {
    matches!(kind, "Slider" | "Switch" | "Spinner" | "FileChooser" | "MenuBar")
}
pub fn owns(kind: &str, prop: &str) -> bool {
    match kind {
        "Slider" => ["min", "max", "step", "value", "orientation", "drawValue", "digits", "marks"].contains(&prop),
        "Switch" => prop == "active",
        "Spinner" => prop == "spinning",
        "FileChooser" => ["open", "action", "multiple", "title", "acceptLabel", "cancelLabel", "currentName", "currentFolder", "filters", "label"].contains(&prop),
        "MenuBar" => prop == "items",
        _ => false,
    }
}
pub fn create(kind: &str, props: &Map<String, Value>, id: u32, parent: Option<&gtk4::ApplicationWindow>, emit: Emit) -> Result<Option<(Widget, State)>, String> {
    let handler = Rc::new(Cell::new(0));
    let mut state = State { handler: handler.clone(), chooser: None };
    let widget: Widget = match kind {
        "Slider" => {
            let get = |key, default| props.get(key).map(number).unwrap_or(Ok(default));
            let (min, max, step) = (get("min", 0.0)?, get("max", 100.0)?, get("step", 1.0)?);
            let value = get("value", min)?;
            range(min, max, step, value)?;
            let orient = props.get("orientation").map(orientation).unwrap_or(Ok(gtk4::Orientation::Horizontal))?;
            let scale = gtk4::Scale::with_range(orient, min, max, step);
            scale.set_value(value);
            scale.upcast()
        }
        "Switch" => gtk4::Switch::new().upcast(),
        "Spinner" => gtk4::Spinner::new().upcast(),
        "MenuBar" => gtk4::PopoverMenuBar::from_model(None::<&gio::Menu>).upcast(),
        "FileChooser" => {
            let dialog = gtk4::FileChooserNative::new(Some("Choose a file"), parent, gtk4::FileChooserAction::Open, None, None);
            let event_handler = handler.clone();
            let event_emit = emit.clone();
            dialog.connect_response(move |dialog, response| {
                let accepted = response == gtk4::ResponseType::Accept;
                let mut uris = Vec::new();
                let mut paths = Vec::new();
                if accepted {
                    let files = dialog.files();
                    for i in 0..files.n_items() {
                        if let Some(file) = files.item(i).and_then(|v| v.downcast::<gio::File>().ok()) {
                            uris.push(file.uri().to_string());
                            paths.push(file.path().map(|p| p.to_string_lossy().into_owned()));
                        }
                    }
                }
                dialog.hide();
                if event_handler.get() != 0 {
                    event_emit.borrow_mut()(Event::Change { id, signal: "response".into(), handler: Some(event_handler.get()), value: json!({"accepted": accepted, "uris": uris, "paths": paths}) });
                }
            });
            let button = gtk4::Button::with_label("Choose a file…");
            let native = dialog.clone();
            button.connect_clicked(move |_| native.show());
            state.chooser = Some(dialog);
            button.upcast()
        }
        _ => return Ok(None),
    };
    // Configuration is applied before `open`: a dialog never appears half-configured.
    for (prop, value) in props {
        if owns(kind, prop) && prop != "open" && !(kind == "Slider" && ["min", "max", "step", "value", "orientation"].contains(&prop.as_str())) {
            set(&widget, Some(&state), prop, value, id, emit.clone()).unwrap()?;
        }
    }
    if kind == "FileChooser" {
        if let Some(value) = props.get("open") { boolean(value)?; /* renderer opens after connecting */ }
    }
    Ok(Some((widget, state)))
}
pub fn set(widget: &Widget, state: Option<&State>, prop: &str, value: &Value, id: u32, emit: Emit) -> Option<Result<(), String>> {
    if let Some(scale) = widget.downcast_ref::<gtk4::Scale>() {
        if prop == "marks" {
            return Some((|| {
                let marks = value.as_array().filter(|m| m.len() <= 5000).ok_or("Slider.marks must be an array of at most 5000 numbers")?;
                let parsed = marks.iter().map(number).collect::<Result<Vec<_>, _>>()?;
                scale.clear_marks();
                for mark in parsed { scale.add_mark(mark, gtk4::PositionType::Bottom, None); }
                Ok(())
            })());
        }
        if ["min", "max", "step", "value", "orientation", "drawValue", "digits"].contains(&prop) {
            return Some((|| {
                let adjustment = scale.adjustment();
                let (mut min, mut max, mut step, mut current) = (adjustment.lower(), adjustment.upper(), adjustment.step_increment(), scale.value());
                match prop {
                    "min" => min = number(value)?, "max" => max = number(value)?, "step" => step = number(value)?, "value" => current = number(value)?,
                    "orientation" => { scale.set_orientation(orientation(value)?); return Ok(()); }
                    "drawValue" => { scale.set_draw_value(boolean(value)?); return Ok(()); }
                    "digits" => { let n = value.as_i64().filter(|n| (-1..=64).contains(n)).ok_or("Slider.digits must be -1..64")?; scale.set_digits(n as i32); return Ok(()); }
                    _ => unreachable!(),
                }
                range(min, max, step, current)?;
                adjustment.configure(current, min, max, step, step * 10.0, 0.0);
                Ok(())
            })());
        }
    }
    if let Some(switch) = widget.downcast_ref::<gtk4::Switch>() {
        if prop == "active" { return Some(boolean(value).map(|active| switch.set_active(active))); }
    }
    if let Some(spinner) = widget.downcast_ref::<gtk4::Spinner>() {
        if prop == "spinning" { return Some(boolean(value).map(|spinning| spinner.set_spinning(spinning))); }
    }
    let state = state?;
    if let Some(dialog) = &state.chooser {
        if owns("FileChooser", prop) { return Some((|| {
            match prop {
                "open" => if boolean(value)? { dialog.show(); } else { dialog.hide(); },
                "action" => { let action = action(value)?; if action == gtk4::FileChooserAction::Save && dialog.selects_multiple() { return Err("Save cannot select multiple files".into()); } dialog.set_action(action); }
                "multiple" => { let multiple = boolean(value)?; if multiple && dialog.action() == gtk4::FileChooserAction::Save { return Err("Save cannot select multiple files".into()); } dialog.set_select_multiple(multiple); }
                "title" => dialog.set_title(text(value)?),
                "acceptLabel" => dialog.set_accept_label(Some(text(value)?)),
                "cancelLabel" => dialog.set_cancel_label(Some(text(value)?)),
                "currentName" => dialog.set_current_name(text(value)?),
                "currentFolder" => { let folder = gio::File::for_path(text(value)?); dialog.set_current_folder(Some(&folder)).map_err(|e| e.to_string())?; }
                "label" => widget.downcast_ref::<gtk4::Button>().unwrap().set_label(text(value)?),
                "filters" => {
                    let parsed = filters(value)?;
                    let existing = dialog.filters();
                    while let Some(filter) = existing.item(0).and_then(|v| v.downcast::<gtk4::FileFilter>().ok()) { dialog.remove_filter(&filter); }
                    for f in parsed {
                        let filter = gtk4::FileFilter::new(); filter.set_name(Some(&f.name));
                        for pattern in f.patterns { filter.add_pattern(&pattern); }
                        for mime in f.mime_types { filter.add_mime_type(&mime); }
                        dialog.add_filter(&filter);
                    }
                }
                _ => unreachable!(),
            }
            Ok(())
        })()); }
    }
    if let Some(bar) = widget.downcast_ref::<gtk4::PopoverMenuBar>() {
        if prop == "items" { return Some((|| {
            let parsed = menu_items(value)?;
            let group = gio::SimpleActionGroup::new();
            fn build(items: &[MenuItem], group: &gio::SimpleActionGroup, handler: &Rc<Cell<u32>>, emit: &Emit, id: u32, serial: &mut u32) -> gio::Menu {
                let menu = gio::Menu::new();
                for item in items {
                    if !item.items.is_empty() { menu.append_submenu(Some(&item.label), &build(&item.items, group, handler, emit, id, serial)); }
                    else {
                        let name = format!("item{}", serial); *serial += 1;
                        let action = gio::SimpleAction::new(&name, None);
                        action.set_enabled(!item.disabled);
                        let handler = handler.clone(); let emit = emit.clone(); let key = item.id.clone().unwrap();
                        action.connect_activate(move |_, _| { if handler.get() != 0 { emit.borrow_mut()(Event::Change { id, signal: "activate".into(), handler: Some(handler.get()), value: Value::String(key.clone()) }); } });
                        group.add_action(&action);
                        menu.append(Some(&item.label), Some(&format!("controls.{name}")));
                    }
                }
                menu
            }
            let model = build(&parsed, &group, &state.handler, &emit, id, &mut 0);
            bar.insert_action_group("controls", Some(&group));
            bar.set_menu_model(Some(&model));
            Ok(())
        })()); }
    }
    None
}
pub fn connect(widget: &Widget, state: Option<&State>, id: u32, signal: &str, handler: u32, updating: Rc<Cell<bool>>, emit: Emit) -> Option<Result<(), String>> {
    if let Some(scale) = widget.downcast_ref::<gtk4::Scale>() {
        return Some(if signal != "value-changed" { Err("Slider expects value-changed".into()) } else {
            scale.connect_value_changed(move |scale| { if !updating.get() { emit.borrow_mut()(Event::Change { id, signal: "value-changed".into(), handler: Some(handler), value: json!(scale.value()) }); } }); Ok(())
        });
    }
    if let Some(switch) = widget.downcast_ref::<gtk4::Switch>() {
        return Some(if signal != "notify::active" { Err("Switch expects notify::active".into()) } else {
            switch.connect_active_notify(move |switch| { if !updating.get() { emit.borrow_mut()(Event::Change { id, signal: "notify::active".into(), handler: Some(handler), value: json!(switch.is_active()) }); } }); Ok(())
        });
    }
    let state = state?;
    if state.chooser.is_some() || widget.is::<gtk4::PopoverMenuBar>() {
        let expected = if state.chooser.is_some() { "response" } else { "activate" };
        return Some(if signal == expected { state.handler.set(handler); Ok(()) } else { Err(format!("Control expects {expected}")) });
    }
    None
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_control_boundaries_without_gtk() {
        assert!(range(0.0, 100.0, 1.0, 20.0).is_ok());
        for args in [(0.0, 0.0, 1.0, 0.0), (0.0, 1.0, 0.0, 0.0), (0.0, 1.0, 1.0, 2.0), (0.0, f64::INFINITY, 1.0, 0.0)] { assert!(range(args.0, args.1, args.2, args.3).is_err()); }
        assert!(menu_items(&json!([{"label":"File","items":[{"id":"open","label":"Open"}]}])).is_ok());
        assert!(menu_items(&json!([{"label":"Missing id"}])).is_err());
        assert!(menu_items(&json!([{"label":"A","id":"x"},{"label":"B","id":"x"}])).is_err());
        assert!(filters(&json!([{"name":"Text","patterns":["*.txt"],"mimeTypes":["text/plain"]}])).is_ok());
        assert!(filters(&json!([{"name":"Empty"}])).is_err());
        assert!(action(&json!("execute")).is_err());
        assert!(boolean(&json!("true")).is_err());
    }
}
