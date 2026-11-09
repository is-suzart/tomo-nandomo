/** Semantic text is supplied by the application so it follows its translator. */
export type AccessibilityValue<T> = T | (() => T);
export interface AccessibilityProps {
  accessibleName?: AccessibilityValue<string>;
  accessibleDescription?: AccessibilityValue<string>;
  /** Exposes validation state where the platform supports it. See ACCESSIBILITY.md. */
  accessibleInvalid?: AccessibilityValue<boolean>;
  accessibleRequired?: AccessibilityValue<boolean>;
}
