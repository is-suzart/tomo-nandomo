/** Compare the value actually carried by the JSON protocol, not object identity. */
export function createWireValueCache() {
  const values = new Map<string, string | undefined>();
  return {
    changed(key: string, value: unknown): boolean {
      const next = JSON.stringify(value);
      if (values.has(key) && values.get(key) === next) return false;
      values.set(key, next);
      return true;
    },
    forget(key: string) { values.delete(key); },
    clear() { values.clear(); },
  };
}

/** Batch physical writes; keep every command and its order, including barriers. */
export function createJsonLineWriter(write: (lines: string) => Promise<void>) {
  type Delivery = { line: string; resolve(): void; reject(error: unknown): void };
  let queue: Delivery[] = [];
  let scheduled = false;
  let closed: Error | undefined;
  const pending = new Set<Delivery>();

  function flush(): Promise<void> {
    scheduled = false;
    if (!queue.length) return Promise.resolve();
    const deliveries = queue;
    queue = [];
    let operation: Promise<void>;
    try { operation = write(deliveries.map(item => item.line).join('')); }
    catch (error) { operation = Promise.reject(error); }
    return operation.then(() => {
      for (const item of deliveries) { pending.delete(item); item.resolve(); }
    }, error => {
      for (const item of deliveries) { pending.delete(item); item.reject(error); }
      throw error;
    });
  }

  return {
    send(command: unknown): Promise<void> {
      if (closed) return Promise.reject(closed);
      let line: string;
      try {
        const encoded=JSON.stringify(command);
        if(encoded===undefined) throw new TypeError('Native command must serialize to JSON');
        line = encoded + '\n';
      }
      catch (error) { return Promise.reject(error); }
      const delivered = new Promise<void>((resolve, reject) => {
        const item = { line, resolve, reject };
        queue.push(item); pending.add(item);
      });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(() => { void flush().catch(() => {}); });
      }
      return delivered;
    },
    flush,
    cancel(error = new Error('Native transport closed')) {
      closed = error;
      queue = [];
      for (const item of pending) item.reject(error);
      pending.clear();
    },
  };
}
