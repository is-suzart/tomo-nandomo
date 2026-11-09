import { withSourceOrigin, sourceError, sourceOrigin } from '@nandomo/core';
// nandomo · bridge-gtk JSX runtime.
//
// Same shape as @nandomo/bridge-web/jsx-runtime — supports component
// composition by detecting the `__componentName` marker the
// `@Component({ name })` decorator stamps on the class.

import { createComponentRef } from './component-ref.js';

const COMPONENT_NAME = '__componentName' as const;

function isComponentClass(tag: unknown): boolean {
  if (typeof tag !== 'function') return false;
  const marker = (tag as unknown as Record<string, unknown>)[COMPONENT_NAME];
  return typeof marker === 'string' && marker.length > 0;
}

function route(tag: unknown, props: unknown): unknown {
  if (tag == null) return tag;
  const safeProps = (props ?? {}) as Record<string, unknown>;

  if (isComponentClass(tag)) {
    return createComponentRef(
      tag as unknown as new () => unknown,
      safeProps,
    );
  }

  // Primitive factory (View, Button, Text, Input, Container, Image, custom
  // user factories, etc.). Same contract as bridge-web/bridge-qml:
  // `tag(props)` returns a SpecNode (or any plain value — render()
  // treats non-spec values as text).
  return (tag as (p: Record<string, unknown>) => unknown)(safeProps);
}

export function jsx(tag: unknown, props: unknown): unknown {
  return route(tag, props);
}

export function jsxs(tag: unknown, props: unknown): unknown {
  return route(tag, props);
}

export function jsxDEV(
  tag: unknown,
  props: unknown,
  _key?: unknown,
  _isStatic?: unknown,
  _source?: unknown,
  _self?: unknown,
): unknown {
  try {
    return withSourceOrigin(route(tag, props), _source);
  } catch (error) {
    const probe = withSourceOrigin({}, _source);
    // Only validated source metadata is attached to the probe.
    throw sourceError(error, sourceOrigin(probe));
  }
}

export function Fragment(props: { children?: unknown }): unknown[] {
  const children = props?.children;
  if (Array.isArray(children)) return children as unknown[];
  if (children == null) return [];
  return [children];
}