// @nandomo/bridge-gtk · public surface.
//
// Primitives are pure — each returns a declarative SpecNode with the
// same shape as @nandomo/bridge-web and @nandomo/bridge-qml. `render()`
// walks the tree and drives a child-process GTK renderer over JSON
// IPC. Cross-stack components port by changing the import — the
// SpecNode shape is the cross-stack contract.
export type { SpecNode } from './primitives/types.js';

export { View, type ViewProps } from './primitives/view.js';
export { Container, type ContainerProps } from './primitives/container.js';
export { Button, type ButtonProps } from './primitives/button.js';
export { Text, type TextProps } from './primitives/text.js';
export { RichText, type RichTextProps } from './primitives/rich-text.js';
export { Select, type SelectProps, type SelectOption } from './primitives/select.js';
export { Input, type InputProps } from './primitives/input.js';
export { Checkbox, type CheckboxProps } from './primitives/checkbox.js';
export { Image, type ImageProps } from './primitives/image.js';

export { render, type RootHandle, type RenderOptions } from './render.js';

export { provideGtkStorage } from './capabilities.js';

// Lower-level exports — useful when integrating with a custom transport
// (tests, embedding bridge-gtk inside another framework).
export {
  startHost,
  resolveHostBinaryPath,
  StdioIpcTransport,
  InMemoryIpcTransport,
  type GtkHost,
  type IpcTransport,
  type Command,
  type HostEvent,
  type StartHostOptions,
} from './host.js';
export { gtk } from './gtk.js';
