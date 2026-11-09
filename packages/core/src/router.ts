import { signal } from './signal.js';
import { computed } from './computed.js';
import { ownCleanup } from './scope.js';
import { For } from './dynamic.js';

export interface Route { id: string; path: string; }
export interface HistoryEntry { readonly href: string; readonly key: string; }
export interface RouterHistory {
  read(): HistoryEntry;
  push(href: string): void;
  replace(href: string): void;
  back(): void;
  subscribe(listener: (entry: HistoryEntry) => void): () => void;
}
export interface RouteLocation extends HistoryEntry {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly route: Route | null;
  readonly params: Readonly<Record<string, string>>;
}
let serial = 0;
export function routeKey(): string { return `nandomo-${Date.now().toString(36)}-${++serial}-${Math.random().toString(36).slice(2)}`; }
/** Internal absolute paths only; validates percent escapes before navigation. */
export function normalizeRouteHref(href: string): string {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\') || /[\u0000-\u0020]/.test(href)) throw new Error('[nandomo/router] Expected an internal absolute path');
  try { decodeURIComponent(href); } catch { throw new Error('[nandomo/router] Invalid percent encoding'); }
  const url = new URL(href, 'https://nandomo.invalid');
  return url.pathname + url.search + url.hash;
}
export function createMemoryHistory(initial = '/'): RouterHistory {
  let entries: HistoryEntry[] = [{ href: normalizeRouteHref(initial), key: routeKey() }];
  let index = 0;
  const listeners = new Set<(entry: HistoryEntry) => void>();
  const notify = () => { for (const listener of [...listeners]) listener(entries[index]!); };
  return {
    read: () => entries[index]!,
    push(href) { const next = { href: normalizeRouteHref(href), key: routeKey() }; entries = [...entries.slice(0, index + 1), next]; index++; notify(); },
    replace(href) { entries[index] = { href: normalizeRouteHref(href), key: routeKey() }; notify(); },
    back() { if (index > 0) { index--; notify(); } },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
export function createRouter(options: { routes: readonly Route[]; initial?: string; history?: RouterHistory }) {
  const ids = new Set<string>();
  const paths = new Set<string>();
  const routes = options.routes.map(route => {
    if (!route.id || ids.has(route.id) || paths.has(route.path)) throw new Error('[nandomo/router] Duplicate or empty route');
    ids.add(route.id); paths.add(route.path);
    if (route.path.startsWith('//') || !route.path.startsWith('/') || route.path.includes('?') || route.path.includes('#') || route.path.includes('*')) throw new Error('[nandomo/router] Invalid route pattern');
    const names = route.path.split('/').filter(segment => segment.startsWith(':')).map(segment => segment.slice(1));
    if (names.some(name => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(name)) || new Set(names).size !== names.length) throw new Error('[nandomo/router] Invalid route parameters');
    return Object.freeze({ ...route });
  }).sort((a, b) => b.path.split('/').filter(part => !part.startsWith(':')).length - a.path.split('/').filter(part => !part.startsWith(':')).length);
  const history = options.history ?? createMemoryHistory(options.initial);
  const entry = signal(history.read());
  const current = computed<RouteLocation>(() => {
    const snapshot = entry();
    let href: string;
    try { href = normalizeRouteHref(snapshot.href); }
    catch {
      return Object.freeze({ ...snapshot, pathname: snapshot.href.split(/[?#]/)[0]!, search: '', hash: '', route: null, params: Object.freeze({}) });
    }
    const url = new URL(href, 'https://nandomo.invalid');
    const segments = url.pathname.split('/');
    for (const route of routes) {
      const pattern = route.path.split('/');
      if (pattern.length !== segments.length) continue;
      const params: Record<string, string> = Object.create(null);
      const matched = pattern.every((part, index) => {
        if (part.startsWith(':')) { if (!segments[index]) return false; params[part.slice(1)] = decodeURIComponent(segments[index]!); return true; }
        return part === segments[index];
      });
      if (matched) return Object.freeze({ ...snapshot, href, pathname: url.pathname, search: url.search, hash: url.hash, route, params: Object.freeze(params) });
    }
    return Object.freeze({ ...snapshot, href, pathname: url.pathname, search: url.search, hash: url.hash, route: null, params: Object.freeze({}) });
  });
  let disposed = false;
  const unsubscribe = history.subscribe(next => entry.set(next));
  const ensure = () => { if (disposed) throw new Error('[nandomo/router] Router disposed'); };
  const dispose = () => { if (disposed) return; disposed = true; unsubscribe(); current.dispose(); };
  ownCleanup(dispose);
  return {
    current,
    push(href: string) { ensure(); history.push(normalizeRouteHref(href)); },
    replace(href: string) { ensure(); history.replace(normalizeRouteHref(href)); },
    back() { ensure(); history.back(); },
    dispose,
  };
}
export type Router = ReturnType<typeof createRouter>;
/** Each history entry mounts a fresh page and owns its component resources. */
export function RouterView(props: { router: Router; children: (location: RouteLocation) => unknown }) {
  return { ...For({ each: () => [props.router.current()], by: location => location.key,
    children: location => props.children(location()), }), disposeBeforeMount: true };
}
