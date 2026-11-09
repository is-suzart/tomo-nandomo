use gtk4::prelude::*;
use gtk4::{accessible, AccessibleInvalidState, Widget};
use serde_json::Value;

/// Semantic properties use GTK's accessibility API, not GObject properties.
pub fn set(widget: &Widget, name: &str, value: &Value) -> Option<Result<(), String>> {
    let result = match name {
        "accessibleName" | "accessibleDescription" => value.as_str()
            .ok_or_else(|| format!("{name} must be a string"))
            .map(|text| widget.update_property(&[if name == "accessibleName" {
                accessible::Property::Label(text)
            } else { accessible::Property::Description(text) }])),
        "accessibleRequired" => value.as_bool().ok_or_else(|| format!("{name} must be boolean"))
            .map(|required| widget.update_property(&[accessible::Property::Required(required)])),
        "accessibleInvalid" => value.as_bool().ok_or_else(|| format!("{name} must be boolean"))
            .map(|invalid| widget.update_state(&[accessible::State::Invalid(if invalid {
                AccessibleInvalidState::True
            } else { AccessibleInvalidState::False })])),
        _ => return None,
    };
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn semantic_properties_update_real_gtk_accessibility_context() {
        gtk4::init().expect("A graphical display and GTK_A11Y=test are required");
        let widget: Widget = gtk4::Entry::new().upcast();
        set(&widget, "accessibleName", &serde_json::json!("Email")).unwrap().unwrap();
        set(&widget, "accessibleDescription", &serde_json::json!("Required")).unwrap().unwrap();
        set(&widget, "accessibleRequired", &serde_json::json!(true)).unwrap().unwrap();
        set(&widget, "accessibleInvalid", &serde_json::json!(true)).unwrap().unwrap();
        unsafe {
            let accessible = widget.as_ptr() as *mut gtk4::ffi::GtkAccessible;
            assert!(gtk4::ffi::gtk_test_accessible_check_property(accessible,
                gtk4::ffi::GTK_ACCESSIBLE_PROPERTY_LABEL, c"Email".as_ptr()).is_null());
            assert!(gtk4::ffi::gtk_test_accessible_check_property(accessible,
                gtk4::ffi::GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, c"Required".as_ptr()).is_null());
            assert!(gtk4::ffi::gtk_test_accessible_check_property(accessible,
                gtk4::ffi::GTK_ACCESSIBLE_PROPERTY_REQUIRED, 1i32).is_null());
            assert!(gtk4::ffi::gtk_test_accessible_check_state(accessible,
                gtk4::ffi::GTK_ACCESSIBLE_STATE_INVALID, gtk4::ffi::GTK_ACCESSIBLE_INVALID_TRUE).is_null());
        }
        set(&widget, "accessibleDescription", &serde_json::json!("")).unwrap().unwrap();
        set(&widget, "accessibleRequired", &serde_json::json!(false)).unwrap().unwrap();
        set(&widget, "accessibleInvalid", &serde_json::json!(false)).unwrap().unwrap();
        unsafe {
            let accessible = widget.as_ptr() as *mut gtk4::ffi::GtkAccessible;
            assert!(gtk4::ffi::gtk_test_accessible_check_property(accessible,
                gtk4::ffi::GTK_ACCESSIBLE_PROPERTY_DESCRIPTION, c"".as_ptr()).is_null());
            assert!(gtk4::ffi::gtk_test_accessible_check_property(accessible,
                gtk4::ffi::GTK_ACCESSIBLE_PROPERTY_REQUIRED, 0i32).is_null());
            assert!(gtk4::ffi::gtk_test_accessible_check_state(accessible,
                gtk4::ffi::GTK_ACCESSIBLE_STATE_INVALID, gtk4::ffi::GTK_ACCESSIBLE_INVALID_FALSE).is_null());
        }
        assert!(set(&widget, "accessibleInvalid", &serde_json::json!("true")).unwrap().is_err());
        assert!(set(&widget, "notSemantic", &serde_json::Value::Null).is_none());
    }
}
