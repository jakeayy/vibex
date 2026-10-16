// X uses a history-based router that re-renders on `popstate`, so pushing a
// state and firing popstate is enough to navigate in-app without a reload.
type Listener = (path: string) => void;

const listeners = new Set<Listener>();
let lastPath = "";

function emit() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    listeners.forEach(fn => {
        try { fn(lastPath); } catch (e) { console.error(e); }
    });
}

export function initRouter() {
    for (const method of ["pushState", "replaceState"] as const) {
        const orig = history[method];
        history[method] = function (this: History, ...args: Parameters<History["pushState"]>) {
            const ret = orig.apply(this, args);
            queueMicrotask(emit);
            return ret;
        };
    }
    addEventListener("popstate", () => queueMicrotask(emit));
    lastPath = location.pathname;
}

export function onRouteChange(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function navigate(path: string) {
    if (location.pathname === path) return;
    history.pushState({}, "", path);
    dispatchEvent(new PopStateEvent("popstate", { state: {} }));
}
