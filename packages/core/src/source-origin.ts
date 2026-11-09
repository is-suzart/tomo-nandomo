/** Development metadata stays out of props, serialized trees and native APIs. */
export interface SourceOrigin { fileName: string; lineNumber: number; columnNumber?: number; component?: string; }
const origins = new WeakMap<object, SourceOrigin>();
export function sourceOrigin(value: unknown): SourceOrigin | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? origins.get(value as object) : undefined;
}
export function withSourceOrigin<T>(value: T, source: unknown, component?: string): T {
  if (!source || typeof source !== 'object') return value;
  const raw = source as Partial<SourceOrigin>;
  if (typeof raw.fileName !== 'string' || !Number.isInteger(raw.lineNumber) || raw.lineNumber! < 1) return value;
  if (value !== null && (typeof value === 'object' || typeof value === 'function') && !origins.has(value as object)) {
    origins.set(value as object, { fileName: raw.fileName, lineNumber: raw.lineNumber!,
      ...(Number.isInteger(raw.columnNumber) && raw.columnNumber! > 0 ? { columnNumber: raw.columnNumber } : {}),
      ...(component ? { component } : {}) });
  }
  return value;
}
export function sourceLabel(origin: SourceOrigin): string {
  return `${origin.fileName}:${origin.lineNumber}${origin.columnNumber ? ':' + origin.columnNumber : ''}${origin.component ? ' (' + origin.component + ')' : ''}`;
}
export function sourceError(error: unknown, origin?: SourceOrigin, property?: string): Error {
  if (!origin) return error instanceof Error ? error : new Error(String(error));
  if (error instanceof SourceError) return error;
  return new SourceError(error, origin, property);
}
export class SourceError extends Error {
  constructor(cause: unknown, readonly origin: SourceOrigin, readonly property?: string) {
    super(`${sourceLabel(origin)}${property ? ' [' + property + ']' : ''}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = 'SourceError';
  }
}
