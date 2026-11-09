// nandomo · bridge-gtk · SpecNode shape.
//
// Identical to @nandomo/bridge-web/primitives/types and
// @nandomo/bridge-qml/primitives/types so component code written
// against one bridge is portable to another — the JSX runtime /
// spec tree shape is the cross-stack contract.
export interface SpecNode {
  readonly __spec: true;
  readonly kind: string;
  readonly props: Record<string, unknown>;
}

export function isSpecNode(value: unknown): value is SpecNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { __spec?: unknown }).__spec === true &&
    typeof (value as { kind?: unknown }).kind === 'string'
  );
}

// WidgetRef — represents a Rust-side GTK widget handle.
//
// Returned by every primitive factory *after* the widget has been
// allocated in the host process. JS-side holds these refs in the
// mount tree (parent child relationships are tracked on both sides
// via `add_child` commands).
//
// Note: the JS-side renderer for bridge-gtk does NOT keep a DOM-style
// element tree. The SpecNode stays declarative; the host process owns
// the actual GTK widgets. The WidgetRef is mostly a debugging aid
// (kind + id) plus a place to register per-instance cleanups.
export interface WidgetRef {
  readonly __widgetRef: true;
  readonly id: number;
  readonly kind: string;
  readonly props: Record<string, unknown>;
  readonly cleanups: Array<() => void>;
}

export const WIDGET_REF_BRAND = '__widgetRef' as const;

export function createWidgetRef(
  id: number,
  kind: string,
  props: Record<string, unknown>,
): WidgetRef {
  return {
    [WIDGET_REF_BRAND]: true,
    id,
    kind,
    props,
    cleanups: [],
  };
}

export function isWidgetRef(value: unknown): value is WidgetRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [k: string]: unknown })[WIDGET_REF_BRAND] === true &&
    typeof (value as { id?: unknown }).id === 'number'
  );
}