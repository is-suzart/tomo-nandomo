import type { AccessibilityProps } from '@nandomo/core';
/** Node-free factories for platform-specific native GTK views. */
interface Common extends AccessibilityProps { children?: unknown; /** Scroll the nearest scrolled view so this widget is visible. */ scrollIntoView?: boolean | (() => boolean); name?: string | (() => string); objectName?: string; visible?: boolean | (() => boolean); cssClasses?: string | (() => string); tooltip_text?: string | (() => string); width_request?: number; height_request?: number; hexpand?: boolean; vexpand?: boolean; }
interface TextProps extends Common { text?: string | (() => string); selectable?: boolean; wrap?: boolean; xalign?: number; ellipsize?: 'end' | 'none'; max_width_chars?: number; }
interface RichTextProps extends Common { markup?: string | (() => string); wrap?: 'word' | 'char' | 'none'; editable?: boolean; justify?: 'left' | 'right' | 'center' | 'fill' | (() => 'left' | 'right' | 'center' | 'fill'); lineHeight?: number | (() => number); left_margin?: number | (() => number); right_margin?: number | (() => number); scrollToChar?: number | (() => number); }
interface SelectOption { value: string; label: string; }
interface SelectProps extends Common { options?: readonly SelectOption[] | (() => readonly SelectOption[]); value?: string | (() => string); onChange?: (value: string) => void; }
interface ButtonProps extends Common { label?: string | (() => string); icon_name?: string | (() => string); iconName?: string | (() => string); onClick?: () => void; disabled?: boolean | (() => boolean); labelAlign?: 'start' | 'center' | 'end'; }
interface InputProps extends Common { text?: string | (() => string); onInput?: (text: string) => void; placeholder?: string; disabled?: boolean | (() => boolean); }
interface BoxProps extends Common { orientation?: 'horizontal' | 'vertical'; spacing?: number; margin_top?: number; margin_bottom?: number; margin_start?: number; margin_end?: number; }
interface WindowProps extends Common { styleSheet?: string | (() => string); title?: string | (() => string); default_width?: number; default_height?: number; width_request?: number; height_request?: number; }

/** Native scale/slider. `onChange` fires with the current value. */
interface SliderProps extends Common { min?: number; max?: number; step?: number; value?: number | (() => number); orientation?: 'horizontal' | 'vertical'; drawValue?: boolean; digits?: number; /** Tick marks under the track (e.g. chapter starts). */ marks?: readonly number[] | (() => readonly number[]); onChange?: (value: number) => void; }
/** Native on/off switch. `onChange` fires with the new state. */
interface SwitchProps extends Common { active?: boolean | (() => boolean); disabled?: boolean | (() => boolean); onChange?: (active: boolean) => void; }
/** Native busy indicator. */
interface SpinnerProps extends Common { spinning?: boolean | (() => boolean); }
/** Native file chooser dialog, shown by a button or driven through `open`. */
interface FileFilter { name: string; patterns?: readonly string[]; mimeTypes?: readonly string[]; }
interface FileChooserResult { accepted: boolean; uris: string[]; paths: string[]; }
interface FileChooserProps extends Common { action?: 'open' | 'save' | 'select-folder'; multiple?: boolean; title?: string; acceptLabel?: string; cancelLabel?: string; currentName?: string; currentFolder?: string; filters?: readonly FileFilter[] | (() => readonly FileFilter[]); label?: string; open?: boolean | (() => boolean); disabled?: boolean | (() => boolean); onChange?: (result: FileChooserResult) => void; }
/** One menu entry. A leaf carries `id`; a branch carries `items`. */
interface MenuItem { label: string; id?: string; disabled?: boolean; items?: readonly MenuItem[]; }
interface MenuBarProps extends Common { items?: readonly MenuItem[] | (() => readonly MenuItem[]); onChange?: (id: string) => void; }

const node = (kind: string, props: object) => ({ __spec: true as const, kind: `gtk:${kind}`, props: { ...props } as Record<string, unknown> });
export const gtk = {
  Window: (props: WindowProps = {}) => node('Window', props),
  ScrollView: (props: Common = {}) => node('Scroll', props),
  Stack: (props: Common & { transition?: string; duration?: number; visibleChild?: string | (() => string) } = {}) => node('Stack', props),
  Box: (props: BoxProps = {}) => node('View', props),
  Label: (props: TextProps = {}) => node('Text', props),
  RichText: (props: RichTextProps = {}) => node('RichText', props),
  Select: (props: SelectProps = {}) => node('Select', props),
  Button: (props: ButtonProps = {}) => node('Button', props),
  Entry: (props: InputProps = {}) => node('Input', props),
  Picture: (props: Common & { src: string | (() => string); contentFit?: 'contain' | 'cover' | 'fill' | 'scale-down' }) => node('Image', props),
  Icon: (props: Common & { iconName: string; pixelSize?: number }) => node('Icon', props),
  Slider: (props: SliderProps = {}) => node('Slider', props),
  Switch: (props: SwitchProps = {}) => node('Switch', props),
  Toggle: (props: SwitchProps = {}) => node('Switch', props),
  Spinner: (props: SpinnerProps = {}) => node('Spinner', props),
  FileChooser: (props: FileChooserProps = {}) => node('FileChooser', props),
  MenuBar: (props: MenuBarProps = {}) => node('MenuBar', props),
};

export type { SliderProps, SwitchProps, SpinnerProps, FileChooserProps, FileChooserResult, FileFilter, MenuBarProps, MenuItem };
