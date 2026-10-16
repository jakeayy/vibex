const styleEls = new Map<string, HTMLStyleElement>();

export function addStyle(id: string, css: string) {
    let el = styleEls.get(id);
    if (!el) {
        el = document.createElement("style");
        el.id = `vibex-style-${id}`;
        styleEls.set(id, el);
    }
    el.textContent = css;
    if (!el.isConnected) (document.head ?? document.documentElement).append(el);
    return el;
}

export function removeStyle(id: string) {
    styleEls.get(id)?.remove();
    styleEls.delete(id);
}

export function onReady(fn: () => void) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn, { once: true });
    else fn();
}
