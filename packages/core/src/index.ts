/**
 * @nandomo/core — reactive core of the nandomo framework.
 *
 * Exports follow the API contract in ARCH/API-CONTRACT-v0.md, with the
 * recon corrections applied (sync effects, lazy computed, batch helper,
 * inputs copy Mocha verbatim).
 */

export { signal, type Signal } from "./signal.js";
export { Dialog, isDialogNode, readDialogBinding, requestDialogClose,
  type DialogNode, type DialogProps, type DialogBinding, type DialogCloseReason,
} from './dialog.js';
export { computed, type Computed } from "./computed.js";
export { effect, type EffectHandle } from "./effect.js";
export { batch } from "./batch.js";
export {
  defineComponent, isDefinedComponentRef,
  type ComponentTarget, type ComponentProps, type ComponentOptions,
  type DefinedComponent, type DefinedComponentRef, type SetupContext,
} from './define-component.js';

export {
  defineCapability,
  inject,
  provideCapability,
  type Capability,
} from "./capability.js";

export { Component, COMPONENT_NAME, type ComponentConfig } from "./component.js";

export {
  onMount,
  onUnmount,
  runMount,
  runUnmount,
  type ComponentLifecycle,
  type MountHook,
  type UnmountHook,
  type Cleanup,
} from "./lifecycle.js";

export {
  input,
  output,
  model,
  isInputRef,
  isOutputRef,
  isModelRef,
  type InputRef,
  type OutputRef,
  type ModelRef,
} from "./inputs.js";

export { ui, responsive, isResponsive, resolveLayoutValue,
  type LayoutProps, type LayoutNode, type LayoutValue, type Responsive,
  type Direction, type Alignment, type Justification,
} from './ui.js';
export { For, Show, isDynamicNode, mountDynamicRegion,
  type ListKey, type ForProps, type ShowProps, type DynamicNode, type RegionAdapter,
} from './dynamic.js';

export { formSignals, type FieldValue, type FieldConfig, type FormField, type SubmitResult } from './forms.js';

export { createRouter, createMemoryHistory, RouterView, type Router, type RouterHistory, type Route, type RouteLocation, type HistoryEntry } from './router.js';
export { component } from './functional-component.js';

export {
  defineTheme, createTheme, isThemeDefinition,
  type ThemeDefinition, type Theme, type ThemeReader, type ThemeSnapshot, type ThemeShape, type ThemeTokens, type ThemeTokenValue,
  type ThemeMode, type ThemeModePreference, type CreateThemeOptions,
} from './theme.js';

export {
  defineAppMeta, defineProject, isAppMeta, isComponentTarget, COMPONENT_TARGETS,
  type AppMeta, type AppMetaConfig, type Project, type ProjectConfig,
  type AppIcons, type AppPlatformMeta, type WebPlatformMeta, type LinuxPlatformMeta,
  type WindowsPlatformMeta, type MacPlatformMeta, type MobilePlatformMeta,
  type OgType, type WebDisplay, type WebOrientation, type StatusBarStyle,
} from './app-meta.js';

export { withSourceOrigin, sourceOrigin, sourceLabel, sourceError, SourceError, type SourceOrigin } from './source-origin.js';

export {
  createTranslator, normalizeLocale, resolveLocale, interpolate, translate,
  DEFAULT_LOCALE,
  type Translator, type TranslatorOptions, type Catalogs, type Catalog, type TranslationValue,
} from './i18n.js';

export type { AccessibilityProps, AccessibilityValue } from './accessibility.js';
