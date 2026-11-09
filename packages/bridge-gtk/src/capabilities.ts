// @nandomo/bridge-gtk · capability providers.
//
// MVP: in-memory key/value store. The real impl, when running against
// the GTK host, would back onto `GSettings` — GNOME's standard
// configuration store (`gio::Settings::set_string` / `get_string`).
// That requires a deeper integration between the Rust host and the
// GIO stack and is left as a follow-up.
//
// `render()` calls `provideGtkStorage()` automatically on its first
// invocation so authors can `inject(Storage)` without manual wiring.

import { provideCapability } from '@nandomo/core';
import { Storage, type StorageAPI } from '@nandomo/bridge-runtime';

const memoryStore = new Map<string, string>();

export function provideGtkStorage(): void {
  const impl: StorageAPI = {
    getItem: (k) => Promise.resolve(memoryStore.has(k) ? memoryStore.get(k)! : null),
    setItem: (k, v) => {
      memoryStore.set(k, v);
      return Promise.resolve();
    },
    removeItem: (k) => {
      memoryStore.delete(k);
      return Promise.resolve();
    },
  };
  provideCapability(Storage, impl);
}

/** Test helper — clears the in-memory store between tests. */
export function __resetGtkStorageForTests(): void {
  memoryStore.clear();
}