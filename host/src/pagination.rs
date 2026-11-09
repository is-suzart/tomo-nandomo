//! Real text measurement for the pages mode.
//!
//! The JS side used to guess how many characters fit on a page. That guess
//! was wrong: a page held far less text than the frame could show, and the
//! reader had to scroll inside a "page". This module asks Pango — the same
//! engine GTK lays the text out with — where the real line breaks fall.

use gtk4::pango::{Context, FontDescription, Layout};

/// Characters per line and lines per page, measured with the real font.
#[derive(Debug, Clone, Copy)]
pub struct PageMetrics {
    /// Average character width in Pango units (1/1024 pt).
    pub char_width: i32,
    /// Height of one rendered line in Pango units.
    pub line_height: i32,
    /// How many lines the frame holds.
    pub lines: i32,
}

impl PageMetrics {
    /// Characters that fit on one page, with a safety margin.
    pub fn chars_per_page(&self) -> usize {
        let per_line = (self.line_height.max(1) as i64 * 1024 / self.char_width.max(1) as i64).max(1);
        let total = per_line * self.lines as i64;
        // 4% margin: a page that overflows hides text, a short one only
        // wastes a little space.
        (total * 96 / 100).max(120) as usize
    }
}

/// Measure the real metrics of `family` at `font_size` inside `width` px.
pub fn measure(family: &str, font_size: f64, width_px: i32, height_px: i32) -> PageMetrics {
    let context = Context::new();
    let mut desc = FontDescription::from_string(family);
    desc.set_absolute_size(font_size * gtk4::pango::SCALE as f64);

    let mut layout = Layout::new(&context);
    layout.set_font_description(Some(&desc));
    if width_px > 0 {
        layout.set_width(width_px * gtk4::pango::SCALE);
    }
    // A representative sample: "n" and spaces dominate book prose.
    layout.set_text("abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ .,;:!?'\"()\n");

    let (width_units, height_units) = layout.size();
    let lines = layout.line_count().max(1);
    let char_width = width_units / (95 / 2) / lines.max(1);
    let line_height = height_units / lines;

    // How many lines fit the frame? Ask Pango for the height of one line.
    let usable_height = height_px.max(1) * gtk4::pango::SCALE;
    let lines_that_fit = if line_height > 0 { usable_height / line_height } else { 1 };

    PageMetrics {
        char_width: char_width.max(1),
        line_height: line_height.max(1),
        lines: lines_that_fit.max(1) as i32,
    }
}

/// Character offsets where the rendered lines start, for `text` in `width` px.
///
/// Used to cut a chapter into pages that match what the reader actually sees.
pub fn line_breaks(family: &str, font_size: f64, width_px: i32, text: &str) -> Vec<usize> {
    let mut breaks = Vec::new();
    if text.is_empty() {
        return breaks;
    }
    let context = Context::new();
    let mut desc = FontDescription::from_string(family);
    desc.set_absolute_size(font_size * gtk4::pango::SCALE as f64);
    let mut layout = Layout::new(&context);
    layout.set_font_description(Some(&desc));
    if width_px > 0 {
        layout.set_width(width_px * gtk4::pango::SCALE);
    }
    layout.set_text(text);

    let count = layout.line_count();
    for line in 0..count {
        let Some(item) = layout.line(line) else { continue };
        let index = item.start_index();
        if index >= 0 {
            let index = index as usize;
            if index > 0 && index < text.len() && !breaks.contains(&index) {
                breaks.push(index);
            }
        }
    }
    breaks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measures_a_positive_page() {
        let metrics = measure("Liberation Serif", 18.0, 660, 480);
        assert!(metrics.char_width > 0);
        assert!(metrics.line_height > 0);
        assert!(metrics.lines > 0);
        assert!(metrics.chars_per_page() > 200);
    }

    #[test]
    fn finds_line_breaks_in_order() {
        let text = "primeira linha de texto\nsegunda linha de texto\nterceira linha\n";
        let breaks = line_breaks("Liberation Serif", 18.0, 400, text);
        assert!(!breaks.is_empty());
        let mut previous = 0;
        for index in breaks {
            assert!(index > previous, "breaks must advance");
            assert!(index < text.len());
            previous = index;
        }
    }
}
