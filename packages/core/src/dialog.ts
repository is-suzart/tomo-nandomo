export type DialogBinding<T> = T | (() => T);
export type DialogCloseReason = 'escape' | 'outside' | 'dismiss';

/** Interaction contract; each bridge supplies its native modal surface. */
export interface DialogProps {
  open: DialogBinding<boolean>;
  title: DialogBinding<string>;
  children?: unknown;
  objectName?: string;
  /** objectName of a focusable descendant; otherwise use native initial focus. */
  initialFocus?: string;
  closeOnEscape?: DialogBinding<boolean>;
  /** Defaults to false. Native GTK modal windows do not support this option. */
  closeOnOutside?: DialogBinding<boolean>;
  onCloseRequest?: (reason: DialogCloseReason) => void;
}

export interface DialogNode {
  readonly __dialog: true;
  readonly props: DialogProps;
}

export function Dialog(props: DialogProps): DialogNode {
  if (props.open == null || props.title == null) throw new TypeError('[nandomo/core] Dialog requires open and title');
  if (props.onCloseRequest != null && typeof props.onCloseRequest !== 'function') {
    throw new TypeError('[nandomo/core] Dialog.onCloseRequest must be a function');
  }
  return { __dialog: true, props };
}

export function isDialogNode(value: unknown): value is DialogNode {
  return typeof value === 'object' && value !== null && (value as Partial<DialogNode>).__dialog === true;
}

export function readDialogBinding<T>(binding: DialogBinding<T>): T {
  return typeof binding === 'function' ? (binding as () => T)() : binding;
}

/** Dismissal is a request: only the application changes the controlled open state. */
export function requestDialogClose(props: DialogProps, reason: DialogCloseReason): void {
  if (!readDialogBinding(props.open)) return;
  if (reason === 'escape' && !readDialogBinding(props.closeOnEscape ?? true)) return;
  if (reason === 'outside' && !readDialogBinding(props.closeOnOutside ?? false)) return;
  props.onCloseRequest?.(reason);
}
