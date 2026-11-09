/** Structural layout contracts. Bridges supply layout engines, without visual styling. */
export type Direction = 'row' | 'column';
export type Alignment = 'start' | 'center' | 'end' | 'stretch';
export type Justification = 'start' | 'center' | 'end';
export interface Responsive<T> {
  readonly base: T;
  readonly minWidth: Readonly<Record<number, T>>;
}
export type LayoutValue<T> = T | Responsive<T> | (() => T | Responsive<T>);
export interface LayoutProps {
  children?: unknown;
  direction?: LayoutValue<Direction>;
  gap?: LayoutValue<number>;
  align?: LayoutValue<Alignment>;
  justify?: LayoutValue<Justification>;
  grow?: number;
  width?: number | 'fill';
  height?: number | 'fill';
  /** Stable native name; also exposed as HTML id. */
  objectName?: string;
}
export interface LayoutNode {
  readonly __spec: true;
  readonly kind: 'ui:Flex' | 'ui:Div';
  readonly props: Record<string, unknown>;
}
export function responsive<T>(base: T, minWidth: Readonly<Record<number, T>>): Responsive<T> {
  for (const width of Object.keys(minWidth)) {
    if (!Number.isFinite(Number(width)) || Number(width) < 0) throw new Error('Invalid layout breakpoint');
  }
  return { base, minWidth };
}
export function isResponsive(value: unknown): value is Responsive<unknown> {
  return typeof value === 'object' && value !== null && 'base' in value && 'minWidth' in value;
}
export function resolveLayoutValue<T>(raw: LayoutValue<T>, width: number): T {
  const value = typeof raw === 'function' ? (raw as () => T | Responsive<T>)() : raw;
  if (!isResponsive(value)) return value as T;
  let result = value.base;
  for (const point of Object.keys(value.minWidth).map(Number).sort((a, b) => a - b)) {
    if (width >= point) result = value.minWidth[point]!;
  }
  return result as T;
}
function node(kind: LayoutNode['kind'], props: LayoutProps): LayoutNode {
  if (props.grow != null && (!Number.isFinite(props.grow) || props.grow < 0)) throw new Error('grow must be nonnegative');
  return { __spec: true, kind, props: { ...props } };
}
export const ui = {
  Div: (props: LayoutProps = {}) => node('ui:Div', props),
  Flex: (props: LayoutProps = {}) => node('ui:Flex', props),
  VStack: (props: Omit<LayoutProps, 'direction'> = {}) => node('ui:Flex', { ...props, direction: 'column' }),
  HStack: (props: Omit<LayoutProps, 'direction'> = {}) => node('ui:Flex', { ...props, direction: 'row' }),
};
