import type { AccessibilityProps } from '@nandomo/core';
// RichText primitive · <RichText> → gtk4::TextView.
//
// Long-form rich text: a book chapter is headings, emphasis and prose
// that must wrap, scroll and stay selectable. A GtkLabel cannot do
// that — it has no text buffer and no height-for-width, so a long
// document inside a ScrolledWindow misbehaves.
//
// `markup` is Pango markup (not HTML): `<b>`, `<i>`, `<span size="...">`,
// `<span foreground="...">`, `<span background="...">`. The caller is
// responsible for escaping plain text.
import type { SpecNode } from './types.js';

export interface RichTextProps extends AccessibilityProps {
  objectName?: string;
  /** Pango markup. Accepts a getter for reactive updates. */
  markup?: string | (() => string);
  /** Wrapping mode. Defaults to word wrapping on the native side. */
  wrap?: 'word' | 'char' | 'none';
  /** Whether the text can be edited. Defaults to false (read-only). */
  editable?: boolean;
  /** Horizontal alignment of the text block. */
  justify?: 'left' | 'right' | 'center' | 'fill';
  /** GTK CSS classes — `class` is reserved in JSX, `cssClasses` is the
   *  working prop on the GTK side. */
  cssClasses?: string | (() => string);
}

export function RichText(props: RichTextProps = {}): SpecNode {
  return {
    __spec: true,
    kind: 'RichText',
    props: { ...props },
  };
}
