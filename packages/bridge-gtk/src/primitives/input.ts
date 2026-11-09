import type { AccessibilityProps } from '@nandomo/core';
// Input primitive · <Input> → gtk4::Entry.
// `value` can be literal or reactive (`() => string`). `onChange`
// fires with the new string value (gtk4::Entry emits `changed` whenever
// the buffer changes; we read the buffer text at that point).
import type { SpecNode } from './types.js';

export interface InputProps extends AccessibilityProps {
  objectName?: string;
  value?: string | (() => string);
  onChange?: (value: string) => void;
  onInput?: (value: string) => void;
  placeholder?: string;
  type?: 'text' | 'number' | 'password' | 'email';
  disabled?: boolean | (() => boolean);
}

export function Input(props: InputProps = {}): SpecNode {
  return {
    __spec: true,
    kind: 'Input',
    props: { ...props },
  };
}