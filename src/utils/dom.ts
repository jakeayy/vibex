const styleEls = new Map<string, HTMLStyleElement>();

export function addStyle(id: string, css: string) {
    let el = styleEls.get(id);
    if (!el) {
        el = document.createElement("style");
        el.id = `vibex-style-${id}`;
        styleEls.set(id, el);
    }
    el.textContent = css;
    const parent = document.head ?? document.documentElement;
    if (parent) {
        if (!el.isConnected) parent.append(el);
    } else {
        // Plugins that start at document-start run before <html> exists.
        onReady(() => { if (styleEls.get(id) === el && !el!.isConnected) document.head.append(el!); });
    }
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
