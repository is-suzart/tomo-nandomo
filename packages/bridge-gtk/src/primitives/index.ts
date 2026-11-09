// Re-export primitives so examples can import them via the
// `bridge-gtk/src/primitives` subpath without pulling in render.ts
// (which spawns a child process and pulls node:child_process).
//
// The primitives themselves are node-free.

export type { SpecNode } from './types.js';
export { View, type ViewProps } from './view.js';
export { Container, type ContainerProps } from './container.js';
export { Button, type ButtonProps } from './button.js';
export { Text, type TextProps } from './text.js';
export { RichText, type RichTextProps } from './rich-text.js';
export { Select, type SelectProps, type SelectOption } from './select.js';
export { Input, type InputProps } from './input.js';
export { Image, type ImageProps } from './image.js';
export { Checkbox, type CheckboxProps } from './checkbox.js';
