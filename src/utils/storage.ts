// Settings live in X's own localStorage under a single key, so the userscript
// needs no GM_* grants and runs fully in the page context.
const KEY = "vibex:settings";

export interface PluginState {
    enabled: boolean;
    [setting: string]: unknown;
}

export interface Settings {
    plugins: Record<string, PluginState>;
}

let cache: Settings | null = null;
let version = 0;

/** Bumped on every save; used as the snapshot for React's useSyncExternalStore. */
export const getSettingsVersion = () => version;
const listeners = new Set<(s: Settings) => void>();

export function getSettings(): Settings {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(KEY);
        cache = raw ? JSON.parse(raw) : { plugins: {} };
    } catch {
        cache = { plugins: {} };
    }
    cache!.plugins ??= {};
    return cache!;
}

export function saveSettings() {
    const s = getSettings();
    try {
        localStorage.setItem(KEY, JSON.stringify(s));
    } catch { /* storage full or blocked; keep in-memory copy */ }
    version++;
    listeners.forEach(fn => fn(s));
}

export function onSettingsChange(fn: (s: Settings) => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}
