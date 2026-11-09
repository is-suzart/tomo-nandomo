//! Boolean input adapter. Application behavior belongs in TypeScript, not here.
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use gtk4::{CheckButton, Widget};
use gtk4::prelude::*;
use serde_json::Value;
use crate::commands::Event;

pub fn create(props: &serde_json::Map<String, Value>) -> Widget {
    CheckButton::builder()
        .label(props.get("label").and_then(Value::as_str).unwrap_or(""))
        .active(props.get("active").and_then(Value::as_bool).unwrap_or(false))
        .build().upcast()
}

pub fn connect(
    widget: &Widget, id: u32, handler: u32, updating: Rc<Cell<bool>>,
    emit: Rc<RefCell<dyn FnMut(Event)>>,
) -> Result<(), String> {
    let checkbox = widget.downcast_ref::<CheckButton>().ok_or("toggled requires a CheckButton")?;
    checkbox.connect_toggled(move |checkbox| {
        if !updating.get() {
            emit.borrow_mut()(Event::Change {
                id, handler: Some(handler), signal: "toggled".into(), value: Value::Bool(checkbox.is_active()),
            });
        }
    });
    Ok(())
}

pub fn toggle(widget: &Widget) -> Result<(), String> {
    let checkbox = widget.downcast_ref::<CheckButton>().ok_or("toggle requires a CheckButton")?;
    if !checkbox.is_sensitive() { return Err("Cannot toggle a disabled CheckButton".into()); }
    checkbox.set_active(!checkbox.is_active());
    Ok(())
}

pub fn active(widget: &Widget) -> Value {
    widget.downcast_ref::<CheckButton>().map(|checkbox| Value::Bool(checkbox.is_active())).unwrap_or(Value::Null)
}
