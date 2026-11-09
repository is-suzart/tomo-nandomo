//! Declarative appearance adapters; applications never construct GTK widgets.
use gtk4::{prelude::*, CssProvider, Widget};
use serde_json::Value;

pub fn stylesheet(widget: &Widget, css: &str, previous: &mut Option<CssProvider>) {
    let display = widget.display();
    if let Some(provider) = previous.take() {
        gtk4::style_context_remove_provider_for_display(&display, &provider);
    }
    let provider = CssProvider::new();
    provider.load_from_string(css);
    gtk4::style_context_add_provider_for_display(&display, &provider, gtk4::STYLE_PROVIDER_PRIORITY_APPLICATION);
    *previous = Some(provider);
}

pub fn set(widget: &Widget, prop: &str, value: &Value) -> Option<Result<(), String>> {
    let result = match prop {
        "cssClasses" => value.as_str().ok_or("cssClasses must be a string".into()).map(|classes| {
            widget.set_css_classes(&classes.split_whitespace().collect::<Vec<_>>());
        }),
        "iconName" => widget.downcast_ref::<gtk4::Image>().ok_or("iconName requires Icon".into()).and_then(|image| {
            let name = value.as_str().ok_or("iconName must be a string")?;
            image.set_icon_name(Some(name)); Ok(())
        }),
        "pixelSize" => widget.downcast_ref::<gtk4::Image>().ok_or("pixelSize requires Icon".into()).and_then(|image| {
            let size = value.as_i64().filter(|n| (1..=512).contains(n)).ok_or("Invalid icon size")?;
            image.set_pixel_size(size as i32); Ok(())
        }),
        "contentFit" => widget.downcast_ref::<gtk4::Picture>().ok_or("contentFit requires Picture".into()).and_then(|picture| {
            let fit = match value.as_str() {
                Some("contain") => gtk4::ContentFit::Contain,
                Some("cover") => gtk4::ContentFit::Cover,
                Some("fill") => gtk4::ContentFit::Fill,
                Some("scale-down") => gtk4::ContentFit::ScaleDown,
                _ => return Err("Invalid contentFit".into()),
            };
            picture.set_content_fit(fit); Ok(())
        }),
        "ellipsize" => widget.downcast_ref::<gtk4::Label>().ok_or("ellipsize requires Label".into()).and_then(|label| {
            let mode = match value.as_str() {
                Some("end") => gtk4::pango::EllipsizeMode::End,
                Some("none") => gtk4::pango::EllipsizeMode::None,
                _ => return Err("Invalid ellipsize".into()),
            };
            label.set_ellipsize(mode); Ok(())
        }),
        _ => return None,
    };
    Some(result)
}
