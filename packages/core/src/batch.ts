import { notificationTransaction } from './runtime.js';

/** Coalesce synchronous writes, including nested batches. Reads see current values.
 * Writes are retained and notifications drained even if the callback throws.
 */
export function batch<T>(fn: () => T): T {
  return notificationTransaction(fn);
}
