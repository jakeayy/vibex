// Request interception for XHR, fetch and sendBeacon. X's API layer uses XHR
// (falling back to fetch), and its telemetry uses all three, so hooking these
// covers every request regardless of which internal client issued it.
//
// Interceptors see each outgoing request and may rewrite its URL/body or
// block it. A blocked request gets an empty 200 locally, so callers treat it
// as delivered and don't retry. For XHR an interceptor runs twice (at open
// with `body: undefined`, then at send with the body), so it must be
// idempotent.

export interface InterceptedRequest {
    url: URL;
    method: string;
    body: unknown;
}

export type RequestDecision = { block: true } | { url?: URL; body?: unknown } | void;
export type Interceptor = (req: InterceptedRequest) => RequestDecision;

/** Read-only view of a completed response; `json()` parses lazily and returns null for non-JSON. */
export interface ObservedResponse {
    url: URL;
    status: number;
    json(): unknown;
}
export type ResponseObserver = (res: ObservedResponse) => void;

const interceptors = new Set<Interceptor>();
const observers = new Set<ResponseObserver>();
let installed = false;

export function addInterceptor(fn: Interceptor) {
    install();
    interceptors.add(fn);
    return () => { interceptors.delete(fn); };
}

/** Observe every completed XHR/fetch response without changing it. */
export function addResponseObserver(fn: ResponseObserver) {
    install();
    observers.add(fn);
    return () => { observers.delete(fn); };
}

function notify(url: URL, status: number, read: () => unknown) {
    let cached: unknown, done = false;
    const res: ObservedResponse = {
        url, status,
        json: () => {
            if (!done) {
                done = true;
                try { cached = read(); } catch { cached = null; }
            }
            return cached;
        },
    };
    for (const fn of observers) {
        try { fn(res); } catch (e) { console.error("[VibeX] response observer failed", e); }
    }
}

function run(req: InterceptedRequest): { blocked: boolean; url: URL; body: unknown } {
    let { url, body } = req;
    for (const fn of interceptors) {
        let d: RequestDecision;
        try {
            d = fn({ ...req, url, body });
        } catch (e) {
            console.error("[VibeX] request interceptor failed", e);
            continue;
        }
        if (!d) continue;
        if ("block" in d) return { blocked: true, url, body };
        if (d.url) url = d.url;
        if ("body" in d) body = d.body;
    }
    return { blocked: false, url, body };
}

function toURL(input: string | URL) {
    try {
        return new URL(String(input), location.href);
    } catch {
        return null;
    }
}

function install() {
    if (installed) return;
    installed = true;

    /* ---------------------------------- XHR --------------------------------- */
    const XHR = XMLHttpRequest.prototype;
    const origOpen = XHR.open;
    const origSend = XHR.send;
    const meta = new WeakMap<XMLHttpRequest, { method: string; url: URL; blocked: boolean }>();
    const observed = new WeakSet<XMLHttpRequest>();

    // URL rewrites and block decisions happen at open(), before the caller
    // sets headers (re-opening later would discard them). The body is only
    // known at send(), so body rewrites happen there.
    XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
        const u = toURL(url);
        if (u && observers.size && !observed.has(this)) {
            observed.add(this);
            // Re-read the URL at load time: the same XHR object can be reused.
            this.addEventListener("load", () => {
                const target = meta.get(this)?.url ?? toURL(this.responseURL);
                if (!target || !observers.size) return;
                notify(target, this.status, () => {
                    if (this.responseType === "json") return this.response;
                    if (this.responseType && this.responseType !== "text") return null;
                    return JSON.parse(this.responseText);
                });
            });
        }
        if (!u || !interceptors.size) {
            meta.delete(this);
            return (origOpen as any).call(this, method, url, ...rest);
        }
        const m = method.toUpperCase();
        const out = run({ url: u, method: m, body: undefined });
        meta.set(this, { method: m, url: out.url, blocked: out.blocked });
        return (origOpen as any).call(this, method, out.url.href, ...rest);
    } as typeof XHR.open;

    XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
        const m = meta.get(this);
        if (!m) return origSend.call(this, body);
        if (m.blocked) return fakeXhrSuccess(this);
        if (body == null) return origSend.call(this, body);
        return origSend.call(this, run({ url: m.url, method: m.method, body }).body as any);
    };

    /* --------------------------------- fetch -------------------------------- */
    const origFetch = window.fetch;
    const observe = (url: URL, p: Promise<Response>) => {
        if (!observers.size) return p;
        return p.then(res => {
            // Clone so the caller's body stays unread; parse only if an observer asks.
            const copy = res.clone();
            copy.text().then(text => notify(url, res.status, () => JSON.parse(text))).catch(() => {});
            return res;
        });
    };
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
        const isReq = input instanceof Request;
        const url = toURL(isReq ? input.url : input);
        if (!url || (!interceptors.size && !observers.size)) return origFetch.call(this, input, init);
        if (!interceptors.size) return observe(url, origFetch.call(this, input, init));

        const method = (init?.method ?? (isReq ? input.method : "GET")).toUpperCase();
        const out = run({ url, method, body: init?.body });
        if (out.blocked) return Promise.resolve(new Response("", { status: 200 }));
        if (out.url.href === url.href && out.body === init?.body) return observe(url, origFetch.call(this, input, init));
        return observe(out.url, origFetch.call(this, isReq ? new Request(out.url, input) : out.url, { ...init, body: out.body as BodyInit }));
    };

    /* ------------------------------- sendBeacon ------------------------------ */
    const origBeacon = navigator.sendBeacon?.bind(navigator);
    if (origBeacon) {
        navigator.sendBeacon = (target: string | URL, data?: BodyInit | null) => {
            const url = toURL(target);
            if (!url || !interceptors.size) return origBeacon(target, data);
            const out = run({ url, method: "POST", body: data });
            return out.blocked ? true : origBeacon(out.url, out.body as BodyInit);
        };
    }
}

/** Completes an XHR locally as an empty 200 without touching the network. */
function fakeXhrSuccess(xhr: XMLHttpRequest) {
    const define = (k: string, v: unknown) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
    define("readyState", 4);
    define("status", 200);
    define("statusText", "OK");
    define("responseText", "");
    define("response", xhr.responseType === "json" ? null : "");
    define("responseURL", "");
    xhr.getAllResponseHeaders = () => "";
    xhr.getResponseHeader = () => null;
    setTimeout(() => {
        for (const type of ["readystatechange", "load", "loadend"]) {
            xhr.dispatchEvent(new ProgressEvent(type));
        }
    });
}

/* --------------------------------- helpers -------------------------------- */

/** API path without host or the `/i/api` prefix X uses for same-origin calls. */
export function apiPath(url: URL) {
    return url.pathname.replace(/^\/i\/api(?=\/)/, "");
}
