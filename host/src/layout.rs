//! Structural layout only. Native children own their appearance and state.
use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use gtk4::{glib, prelude::*, subclass::prelude::*, Orientation, Widget};
use serde_json::Value;

fn resolve(value: &Value, width: i32) -> Value {
    let Some(base) = value.get("base") else { return value.clone(); };
    let mut result = base.clone();
    let mut points: Vec<(f64, &Value)> = value.get("minWidth").and_then(Value::as_object)
        .into_iter().flatten().filter_map(|(key, value)| key.parse::<f64>().ok().map(|point| (point, value))).collect();
    points.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (point, value) in points { if f64::from(width.max(0)) >= point { result = value.clone(); } }
    result
}

#[derive(Clone, Debug, PartialEq)]
struct Config { row: bool, gap: i32, align: String, justify: String }
impl Default for Config {
    fn default() -> Self { Self { row: false, gap: 0, align: "stretch".into(), justify: "start".into() } }
}

mod imp {
    use super::*;
    use gtk4::glib;
    #[derive(Default)]
    pub struct Layout {
        pub flex: Cell<bool>,
        pub props: RefCell<HashMap<String, Value>>,
        pub width: Cell<i32>,
        pub(super) active: RefCell<Config>,
    }
    #[glib::object_subclass]
    impl ObjectSubclass for Layout {
        const NAME: &'static str = "NandomoStructuralLayout";
        type Type = super::Layout;
        type ParentType = Widget;
    }
    impl ObjectImpl for Layout {
        fn dispose(&self) { while let Some(child) = self.obj().first_child() { child.unparent(); } }
    }
    impl WidgetImpl for Layout {
        fn request_mode(&self) -> gtk4::SizeRequestMode { gtk4::SizeRequestMode::HeightForWidth }
        fn measure(&self, orientation: Orientation, for_size: i32) -> (i32, i32, i32, i32) {
            let obj = self.obj();
            let width = if orientation == Orientation::Vertical && for_size >= 0 { for_size } else { self.width.get() };
            let config = obj.config(width);
            let children = obj.layout_children();
            let main = self.flex.get() && (orientation == Orientation::Horizontal) == config.row;
            let mut minimum = 0i32;
            let mut natural = 0i32;
            // A column breakpoint must remain reachable even when the active row
            // has a larger native minimum. Vertical measurement uses for_size.
            let responsive_column = orientation == Orientation::Horizontal && obj.has_column_breakpoint();
            for child in &children {
                let constraint = if main { -1 } else { for_size };
                let (min, nat, _, _) = child.measure(orientation, constraint);
                minimum = if main && !responsive_column { minimum.saturating_add(min) } else { minimum.max(min) };
                natural = if main { natural.saturating_add(nat) } else { natural.max(nat) };
            }
            if main {
                let gaps = config.gap.saturating_mul(children.len().saturating_sub(1) as i32);
                if !responsive_column { minimum = minimum.saturating_add(gaps); }
                natural = natural.saturating_add(gaps);
            }
            // Numeric dimensions bound natural size (e.g. cached artwork),
            // while genuine native minimums remain respected.
            let axis = if orientation == Orientation::Horizontal { "width" } else { "height" };
            if let Some(size) = self.props.borrow().get(axis).and_then(Value::as_f64) {
                let size = size.round() as i32;
                return (minimum.max(size), minimum.max(size), -1, -1);
            }
            (minimum, natural.max(minimum), -1, -1)
        }
        fn size_allocate(&self, width: i32, height: i32, _baseline: i32) {
            let obj = self.obj();
            self.width.set(width);
            let config = obj.config(width);
            let changed = *self.active.borrow() != config;
            *self.active.borrow_mut() = config.clone();
            if changed { obj.queue_resize(); }
            let children = obj.layout_children();
            if !self.flex.get() {
                for child in children {
                    let (_, natural_width, _, _) = child.measure(Orientation::Horizontal, -1);
                    let child_width = if super::Layout::fills(&child, "width") { width } else { natural_width };
                    let (_, natural_height, _, _) = child.measure(Orientation::Vertical, child_width);
                    let child_height = if super::Layout::fills(&child, "height") { height } else { natural_height };
                    child.allocate(child_width.max(0), child_height.max(0), -1, None);
                }
                return;
            }
            let (main_space, cross_space, main_axis, cross_axis) = if config.row {
                (width, height, Orientation::Horizontal, Orientation::Vertical)
            } else { (height, width, Orientation::Vertical, Orientation::Horizontal) };
            let gap_total = config.gap.saturating_mul(children.len().saturating_sub(1) as i32);
            let mut sizes = vec![0; children.len()];
            let mut growers = Vec::new();
            let mut available = main_space.saturating_sub(gap_total);
            for (index, child) in children.iter().enumerate() {
                let (minimum, natural, _, _) = child.measure(main_axis, if config.row { -1 } else { cross_space });
                let grow = super::Layout::grow(child, main_axis);
                if grow > 0.0 { growers.push((index, grow, minimum)); }
                else {
                    let fill = super::Layout::fills(child, if config.row { "width" } else { "height" });
                    sizes[index] = if fill { main_space.max(minimum) } else { natural };
                    available = available.saturating_sub(sizes[index]);
                }
            }
            distribute(&mut sizes, &growers, available.max(0));
            let used = sizes.iter().fold(gap_total, |sum, size| sum.saturating_add(*size));
            let extra = main_space.saturating_sub(used).max(0);
            let mut position = match config.justify.as_str() { "center" => extra / 2, "end" => extra, _ => 0 };
            for (index, child) in children.iter().enumerate() {
                let (_, natural_cross, _, _) = child.measure(cross_axis, sizes[index]);
                let dimension = if config.row { "height" } else { "width" };
                let explicit = super::Layout::dimension(child, dimension).is_some();
                let cross = if super::Layout::fills(child, dimension) || (config.align == "stretch" && !explicit) {
                    cross_space
                } else { natural_cross.min(cross_space).max(0) };
                let cross_offset = match config.align.as_str() { "center" => (cross_space - cross) / 2, "end" => cross_space - cross, _ => 0 }.max(0);
                let (x, y, w, h) = if config.row { (position, cross_offset, sizes[index], cross) } else { (cross_offset, position, cross, sizes[index]) };
                let transform = gtk4::gsk::Transform::new().translate(&gtk4::graphene::Point::new(x as f32, y as f32));
                child.allocate(w.max(0), h.max(0), -1, Some(transform));
                position = position.saturating_add(sizes[index]).saturating_add(config.gap);
            }
        }
        fn snapshot(&self, snapshot: &gtk4::Snapshot) {
            for child in self.obj().layout_children() { self.obj().snapshot_child(&child, snapshot); }
        }
    }
}

glib::wrapper! {
    pub struct Layout(ObjectSubclass<imp::Layout>) @extends Widget,
        @implements gtk4::Accessible, gtk4::Buildable, gtk4::ConstraintTarget;
}

impl Layout {
    pub fn new(flex: bool) -> Self {
        let obj: Self = glib::Object::new();
        obj.imp().flex.set(flex);
        obj
    }
    pub fn set_layout_prop(&self, key: &str, value: Value) -> Result<(), String> {
        match key {
            "direction" | "gap" | "align" | "justify" | "grow" | "width" | "height" => {},
            _ => return Err(format!("Unsupported layout property: {key}")),
        }
        self.imp().props.borrow_mut().insert(key.into(), value);
        let props = self.imp().props.borrow();
        let request = |key: &str| props.get(key).and_then(Value::as_f64).map(|v| v.round() as i32).unwrap_or(-1);
        self.set_size_request(request("width"), request("height"));
        let expand = |key: &str| props.get(key).and_then(Value::as_str) == Some("fill") || props.get("grow").and_then(Value::as_f64).unwrap_or(0.0) > 0.0;
        self.set_hexpand(expand("width")); self.set_vexpand(expand("height"));
        drop(props);
        self.queue_resize();
        if let Some(parent) = self.parent() { parent.queue_resize(); }
        Ok(())
    }
    fn config(&self, width: i32) -> Config {
        let props = self.imp().props.borrow();
        let text = |key: &str, default: &str| props.get(key).map(|value| resolve(value, width)).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or(default.into());
        Config { row: text("direction", "column") == "row", gap: props.get("gap").map(|value| resolve(value, width)).and_then(|value| value.as_f64()).unwrap_or(0.0).round() as i32,
            align: text("align", "stretch"), justify: text("justify", "start") }
    }
    fn has_column_breakpoint(&self) -> bool {
        let props = self.imp().props.borrow();
        let Some(direction) = props.get("direction") else { return true; };
        direction.get("base").and_then(Value::as_str) == Some("column") || direction.get("minWidth").and_then(Value::as_object).map(|points| points.values().any(|value| value == "column")).unwrap_or(false)
    }
    fn dimension(child: &Widget, key: &str) -> Option<Value> {
        child.downcast_ref::<Layout>().and_then(|layout| layout.imp().props.borrow().get(key).cloned())
    }
    fn fills(child: &Widget, key: &str) -> bool {
        if child.downcast_ref::<Layout>().is_some() {
            return Self::dimension(child, key).as_ref().and_then(Value::as_str) == Some("fill");
        }
        child.compute_expand(if key == "width" { Orientation::Horizontal } else { Orientation::Vertical })
    }
    fn grow(child: &Widget, axis: Orientation) -> f64 {
        if let Some(layout) = child.downcast_ref::<Layout>() {
            return layout.imp().props.borrow().get("grow").and_then(Value::as_f64).unwrap_or(0.0);
        }
        // GTK containers inherit expansion from descendants (e.g. Scroll).
        // Respect that request when the child has no structural grow prop.
        if child.compute_expand(axis) { 1.0 } else { 0.0 }
    }
    fn layout_children(&self) -> Vec<Widget> {
        let mut children = Vec::new();
        let mut child = self.first_child();
        while let Some(current) = child { child = current.next_sibling(); if current.should_layout() { children.push(current); } }
        children
    }
    pub fn append(&self, child: &Widget) { child.set_parent(self); self.queue_resize(); }
    pub fn remove(&self, child: &Widget) { if child.parent().as_ref() == Some(self.upcast_ref()) { child.unparent(); self.queue_resize(); } }
    pub fn reorder(&self, children: &[Widget]) {
        let mut previous: Option<&Widget> = None;
        for child in children { child.insert_after(self, previous); previous = Some(child); }
        self.queue_resize();
    }
    pub fn resolved(&self) -> Value {
        let config = self.config(self.width());
        serde_json::json!({"direction": if config.row { "row" } else { "column" }, "gap": config.gap, "align": config.align, "justify": config.justify})
    }
}

/// Zero-basis weighted growth with native minimum constraints and deterministic rounding.
fn distribute(sizes: &mut [i32], growers: &[(usize, f64, i32)], space: i32) {
    let mut pending = growers.to_vec();
    let mut remaining = space;
    loop {
        let weight: f64 = pending.iter().map(|(_, weight, _)| weight).sum();
        if weight <= 0.0 { break; }
        let clamped: Vec<usize> = pending.iter().filter(|(_, w, min)| f64::from(remaining) * w / weight < f64::from(*min)).map(|(index, _, _)| *index).collect();
        if clamped.is_empty() {
            let mut cumulative = 0.0;
            let mut previous = 0;
            for (index, w, _) in pending { cumulative += w; let end = (f64::from(remaining) * cumulative / weight).round() as i32; sizes[index] = (end - previous).max(0); previous = end; }
            break;
        }
        pending.retain(|(index, _, min)| {
            if clamped.contains(index) { sizes[*index] = *min; remaining = remaining.saturating_sub(*min).max(0); false } else { true }
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weighted_growth_conserves_space_and_obeys_minimums() {
        let mut sizes = [0, 0];
        distribute(&mut sizes, &[(0, 1.0, 0), (1, 2.0, 0)], 301);
        assert_eq!(sizes, [100, 201]);
        distribute(&mut sizes, &[(0, 1.0, 150), (1, 2.0, 20)], 300);
        assert_eq!(sizes, [150, 150]);
        distribute(&mut sizes, &[(0, 1.0, 150), (1, 2.0, 200)], 100);
        assert_eq!(sizes, [150, 200]);
    }
    #[test]
    fn breakpoint_resolution_uses_inclusive_sorted_container_widths() {
        let value = serde_json::json!({"base":"column", "minWidth":{"800":"column", "600":"row"}});
        assert_eq!(resolve(&value, 599), "column");
        assert_eq!(resolve(&value, 600), "row");
        assert_eq!(resolve(&value, 800), "column");
    }
}
