import type { AccessibilityProps } from '@nandomo/core';
import type { SpecNode } from './types.js';

export interface CheckboxProps extends AccessibilityProps {
  label: string | (() => string);
  checked?: boolean | (() => boolean);
  onChange?: (checked: boolean) => void;
  disabled?: boolean | (() => boolean);
  objectName?: string;
}

/** Controlled boolean input. Programmatic checked updates do not emit onChange. */
export function Checkbox(props: CheckboxProps): SpecNode {
  const { checked = false, onChange, ...rest } = props;
  return { __spec: true, kind: 'CheckButton', props: {
    ...rest, active: checked, ...(onChange ? { onToggle: onChange } : {}),
  } };
}
