// nandomo · bridge-gtk handler registry.
//
// GTK signals come back from the host as
//   {"event":"signal", "id":N, "signal":"clicked", "handler":M}
// We look up the callback by integer id M and invoke it.
//
// Mirrors the integer-id pattern from @nandomo/bridge-qml/handlers:
// the JSX runtime can't reference JS callbacks by name across an
// stdio boundary, so we allocate dense integer IDs at handler-registration
// time and the host stores the same numeric IDs (sent via the
// `connect` command).

export type HandlerId = number;

export class HandlerRegistry {
  private nextId: HandlerId = 0;
  private readonly byId = new Map<HandlerId, (...args: unknown[]) => unknown>();

  /** Register a callback. Returns the integer id the host uses to call back. */
  register(fn: (...args: unknown[]) => unknown): HandlerId {
    const id = this.nextId++;
    this.byId.set(id, fn);
    return id;
  }

  /** Look up a registered handler. Returns null if the id isn't known. */
  get(id: HandlerId): ((...args: unknown[]) => unknown) | null {
    return this.byId.get(id) ?? null;
  }

  unregister(id: HandlerId): void { this.byId.delete(id); }

  /** Number of registered handlers (debug aid). */
  size(): number {
    return this.byId.size;
  }

  /** Drop all handlers — used by render() on dispose. */
  clear(): void {
    this.byId.clear();
    this.nextId = 0;
  }
}

/** Per-render handler registry. */
export function createHandlerRegistry(): HandlerRegistry {
  return new HandlerRegistry();
}