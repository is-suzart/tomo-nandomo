import { submitNativeUpdate } from './host.js';
import { createWireValueCache } from '@nandomo/bridge-runtime/native-updates';
import { effect, isResponsive, type LayoutNode } from '@nandomo/core';
import type { GtkHost } from './host.js';

const allowed = new Set(['children', 'objectName', 'grow', 'width', 'height', 'direction', 'gap', 'align', 'justify']);
const choices: Record<string, readonly string[]> = {
  direction: ['row', 'column'], align: ['start', 'center', 'end', 'stretch'], justify: ['start', 'center', 'end'],
};
const defaults: Record<string, unknown> = { direction: 'column', gap: 0, align: 'stretch', justify: 'start' };
function number(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function dimension(value: unknown): boolean { return value === 'fill' || (number(value) && value <= 2147483647); }
function validate(key: string, value: unknown): unknown {
  if (isResponsive(value)) {
    if (!value.minWidth || typeof value.minWidth !== 'object' || Array.isArray(value.minWidth)) throw new Error(`[nandomo/gtk] Invalid ${key} breakpoints`);
    validate(key, value.base);
    const points: Record<string, unknown> = {};
    for (const [point, candidate] of Object.entries(value.minWidth)) {
      if (!Number.isFinite(Number(point)) || Number(point) < 0) throw new Error(`[nandomo/gtk] Invalid breakpoint: ${point}`);
      if (isResponsive(candidate)) throw new Error('[nandomo/gtk] Nested responsive values are unsupported');
      points[point] = validate(key, candidate);
    }
    return { base: value.base, minWidth: points };
  }
  const valid = key === 'gap' ? number(value) && value <= 2147483647 : typeof value === 'string' && choices[key]?.includes(value);
  if (!valid) throw new Error(`[nandomo/gtk] Invalid layout ${key}: ${String(value)}`);
  return value;
}

/** Getter updates cross IPC; width-dependent rules remain in the native allocator. */
export function mountGtkLayout(
  node: LayoutNode,
  host: GtkHost,
  mountChildren: (parentId: number, children: unknown, cleanups: Array<() => void>) => void,
): { id: number; cleanups: Array<() => void> } {
  for (const key of Object.keys(node.props)) if (!allowed.has(key)) throw new Error(`[nandomo/gtk] Unsupported layout prop: ${key}`);
  const props = node.props;
  if (props.objectName !== undefined && (typeof props.objectName !== 'string' || !props.objectName)) throw new Error('[nandomo/gtk] objectName must be nonempty');
  if (props.grow !== undefined && !number(props.grow)) throw new Error('[nandomo/gtk] grow must be nonnegative and finite');
  for (const key of ['width', 'height']) if (props[key] !== undefined && !dimension(props[key])) throw new Error(`[nandomo/gtk] Invalid ${key}`);
  const id = host.create(node.kind === 'ui:Flex' ? 'LayoutFlex' : 'LayoutDiv', {}).id;
  const resources: Array<() => void> = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of resources.splice(0).reverse()) { try { cleanup(); } catch (error) { errors.push(error); } }
    if (host.isAlive()) submitNativeUpdate(host, host.destroy(id));
    if (errors.length) throw new AggregateError(errors, 'GTK layout cleanup failed');
  };
  try {
    for (const key of ['grow', 'width', 'height']) if (props[key] !== undefined) submitNativeUpdate(host, host.set(id, key, props[key]));
    if (node.kind === 'ui:Flex') {
      const previous = createWireValueCache();
      for (const [key, fallback] of Object.entries(defaults)) {
        const raw = props[key] ?? fallback;
        const handle = effect(() => {
          const value: unknown = typeof raw === 'function' ? (raw as () => unknown)() : raw;
          const next = validate(key, value);
          if (previous.changed(key, next)) submitNativeUpdate(host, host.set(id, key, next));
        });
        resources.push(() => handle.dispose());
      }
    }
    mountChildren(id, props.children, resources);
    return { id, cleanups: [dispose] };
  } catch (error) { try { dispose(); } catch {} throw error; }
}
