// @nandomo/bridge-runtime · capability contract layer.
//
// This entry contains INTERFACES and CAPABILITY TOKENS. Shared native transport
// utilities live in the separate ./native-updates entry. Bridges (bridge-web, future bridge-mobile, bridge-qml, bridge-gtk)
// import this package to declare which capabilities they expose, then call
// `provideCapability()` from `@nandomo/core` to register their own
// platform-specific implementation. Components (the author .tsx) import this
// package to read the token via `inject()` and consume the platform impl
// without ever knowing which bridge is active.
//
// The classic "same logic, multiple stacks" pattern: the Counter component
// calls `inject(Storage).getItem(...)` and works against `localStorage` on the
// web, `SharedPreferences` on Android, `NSUserDefaults` on iOS, etc — without
// a single `if (platform === ...)` in user code.

import { defineCapability } from '@nandomo/core';

// ─── Storage capability ────────────────────────────────────────────────────
//
// Minimal async key/value store. Promises reflect the worst case across stacks
// (disk-backed Android storage must run outside the UI thread); synchronous
// bridges can wrap their results in `Promise.resolve(...)`.

export interface StorageAPI {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * Storage capability token. Components `inject(Storage)`; the active bridge
 * must `provideCapability(Storage, impl)` during its initialization.
 */
export const Storage = defineCapability<StorageAPI>('storage');

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface HttpRequest {
  readonly response: Promise<HttpResponse>;
  /** Idempotent; rejects a pending response with an Error named AbortError. */
  cancel(): void;
}

/** Buffered text GET. HTTP error statuses resolve; transport failures reject. */
export interface HttpAPI {
  get(url: string): HttpRequest;
}

export const Http = defineCapability<HttpAPI>('http');

// ─── Re-exports for convenience ────────────────────────────────────────────
//
// Author code that wants `inject` without also importing `@nandomo/core` can
// pull it from here. Bridges likewise. The definitions themselves come from
// `@nandomo/core` (single source of truth for the registry + brand types).

export { defineCapability, inject, provideCapability } from '@nandomo/core';
export type { Capability } from '@nandomo/core';
