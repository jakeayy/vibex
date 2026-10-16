import { Logger } from "../utils/logger";

const logger = new Logger("Webpack", "#f59e0b");
const CHUNK_KEY = "webpackChunk_twitter_responsive_web";

type ModuleFactory = (module: any, exports: any, require: WebpackRequire) => void;
type Chunk = [ids: unknown[], modules: Record<string, ModuleFactory>, runtime?: (req: WebpackRequire) => void];

export interface WebpackRequire {
    (id: string | number): any;
    m: Record<string, ModuleFactory>;
    c: Record<string, { id: string; loaded: boolean; exports: any }>;
}

export type PatchReplace = string | ((match: string, ...groups: string[]) => string);

export interface PatchReplacement {
    match: string | RegExp;
    replace: PatchReplace;
}

export interface Patch {
    /** String (or RegExp) that uniquely identifies the target module's source. */
    find: string | RegExp;
    replacement: PatchReplacement | PatchReplacement[];
    /** Patch every module matching `find`, not only the first one. */
    all?: boolean;
    /** Filled in by the plugin manager. */
    plugin?: string;
}

export let wreq: WebpackRequire | undefined;
export let hookedEarly = false;

const patches: Patch[] = [];
const PATCHED = Symbol("vibex.patched");

export const stats = {
    chunks: 0,
    modulesSeen: 0,
    patched: [] as { plugin: string; module: string }[],
    failed: [] as { plugin: string; module: string; error: string }[],
};

export function addPatch(p: Patch) {
    patches.push(p);
}

/** Registered patches that haven't matched any module yet (X may have changed). */
export function unappliedPatches() {
    return patches.filter(p => !(p as any).applied);
}

function matches(src: string, find: string | RegExp) {
    return typeof find === "string" ? src.includes(find) : find.test(src);
}

let nonce: string | undefined;

function getNonce() {
    if (nonce) return nonce;
    for (const s of document.querySelectorAll("script")) if (s.nonce) return (nonce = s.nonce);
}

/**
 * Evaluates `expr` in the page. x.com's CSP forbids eval/new Function (and
 * reports violations), but allows inline scripts carrying the page's nonce,
 * which every <script> on the page exposes via `.nonce`.
 */
function evaluate(expr: string, tag: string): any {
    const n = getNonce();
    if (!n) throw new Error("No CSP nonce found on the page");
    const key = "__vibexCompiled";
    const s = document.createElement("script");
    s.nonce = n;
    s.textContent = `window.${key}=${expr}\n//# sourceURL=${tag}`;
    (document.head ?? document.documentElement).append(s);
    s.remove();
    const out = (window as any)[key];
    delete (window as any)[key];
    // Syntax errors in inline scripts are reported to window.onerror, not thrown.
    if (out === undefined) throw new SyntaxError("Patched module failed to compile");
    return out;
}

/**
 * Turns a module factory's source back into a callable function. X ships its
 * modules as object method shorthand (`123456(e,t,n){...}`), which is not a
 * valid expression on its own, so it is wrapped in an object literal first.
 */
function compile(id: string, src: string): ModuleFactory {
    const tag = `vibex:///WebpackModule${id}`;
    if (/^(?:async\s+)?(?:function\b|\()/.test(src)) return evaluate(`(${src})`, tag);
    return Object.values(evaluate(`({${src}})`, tag))[0] as ModuleFactory;
}

function patchFactory(id: string, factory: ModuleFactory): ModuleFactory {
    stats.modulesSeen++;
    if (!patches.length || (factory as any)[PATCHED]) return factory;

    const original = factory.toString();
    let src = original;
    let patched: ModuleFactory | undefined;
    const applied: string[] = [];

    for (const patch of patches) {
        if ((patch as any).done || !matches(src, patch.find)) continue;

        // $self lets a patch call back into its own plugin object.
        const self = `window.VibeX.plugins.get(${JSON.stringify(patch.plugin)})`;
        const reps = Array.isArray(patch.replacement) ? patch.replacement : [patch.replacement];
        let next = src;
        const missed: (string | RegExp)[] = [];
        for (const { match, replace } of reps) {
            const out = typeof replace === "function"
                ? next.replace(match as any, (...m: any[]) => replace(...(m as [string, ...string[]])).replaceAll("$self", self))
                : next.replace(match as any, replace.replaceAll("$self", self));
            if (out === next) missed.push(match);
            next = out;
        }
        // `find` can match unrelated modules; only a patch that changed something counts.
        if (next === src) continue;
        if (missed.length) logger.warn(`Patch by ${patch.plugin} only partially applied in module ${id}`, missed);

        try {
            patched = compile(id, next);
            src = next;
            applied.push(patch.plugin!);
            stats.patched.push({ plugin: patch.plugin!, module: id });
            (patch as any).applied = true;
            if (!patch.all) (patch as any).done = true;
        } catch (e) {
            stats.failed.push({ plugin: patch.plugin!, module: id, error: String(e) });
            logger.error(`Patch by ${patch.plugin} broke module ${id}, skipping it`, e);
        }
    }

    if (!patched) return factory;
    logger.debug(`Patched module ${id} (${applied.join(", ")})`);
    (patched as any)[PATCHED] = true;
    (patched as any).toString = () => original;
    return patched;
}

function patchChunk(chunk: Chunk) {
    if (!Array.isArray(chunk) || (chunk as any)[PATCHED]) return;
    (chunk as any)[PATCHED] = true;
    stats.chunks++;
    const modules = chunk[1];
    if (!modules) return;
    for (const id of Object.keys(modules)) modules[id] = patchFactory(id, modules[id]);
}

/** Grab webpack's internal `require` by pushing a fake chunk with a runtime callback. */
function captureRequire(arr: any[]) {
    if (wreq) return;
    arr.push([[Symbol("vibex")], {}, (r: WebpackRequire) => { wreq = r; }]);
    if (wreq) logger.info("Captured webpack require");
}

function hookArray(arr: any[]) {
    const wrap = (push: (...items: any[]) => number) => function (this: any, ...chunks: Chunk[]) {
        chunks.forEach(patchChunk);
        return push.apply(arr, chunks);
    };

    let current = wrap(Array.prototype.push.bind(arr));
    Object.defineProperty(arr, "push", {
        configurable: true,
        get: () => current,
        // webpack's runtime replaces `push` with its JSONP callback once it boots.
        set(v) {
            current = wrap(v);
            queueMicrotask(() => captureRequire(arr));
        },
    });
}

export function initWebpack() {
    const existing = (window as any)[CHUNK_KEY];
    if (existing) {
        logger.warn("VibeX loaded after X's bundles; webpack patches will not apply this session.");
        captureRequire(existing);
        return;
    }
    hookedEarly = true;
    const arr: any[] = [];
    (window as any)[CHUNK_KEY] = arr;
    hookArray(arr);
}

/* ---------------------------------- finders --------------------------------- */

export type Filter = (exports: any) => boolean;

export const filters = {
    byProps: (...props: string[]): Filter => e => e != null && props.every(p => p in Object(e)),
    byCode: (...code: string[]): Filter => e => {
        if (typeof e !== "function") return false;
        const s = Function.prototype.toString.call(e);
        return code.every(c => s.includes(c));
    },
};

/** Searches the loaded module cache, including each module's named exports. */
export function find(filter: Filter, all?: false): any;
export function find(filter: Filter, all: true): any[];
export function find(filter: Filter, all = false): any {
    if (!wreq) return all ? [] : undefined;
    const found: any[] = [];
    for (const mod of Object.values(wreq.c)) {
        const e = mod?.exports;
        if (e == null || e === window) continue;
        try {
            if (filter(e)) { if (!all) return e; found.push(e); continue; }
            if (typeof e === "object") {
                for (const k in e) {
                    const v = e[k];
                    if (v != null && filter(v)) { if (!all) return v; found.push(v); }
                }
            }
        } catch { /* some exports throw on access */ }
    }
    return all ? found : undefined;
}

export const findByProps = (...props: string[]) => find(filters.byProps(...props));
export const findByCode = (...code: string[]) => find(filters.byCode(...code));

const moduleCodeCache = new Map<string, string>();

/**
 * Exports of the module whose factory source contains every string. With
 * several matches, prefers initialised modules, then the smallest (the most
 * specific one). Uninitialised modules are required on demand; their chunk
 * is loaded, since their factory is known.
 */
export function findModuleByCode(...code: string[]): any {
    if (!wreq) return;
    const key = code.join("\0");
    let id = moduleCodeCache.get(key);
    if (id == null) {
        const size = (i: string) => wreq!.m[i].toString().length;
        id = searchModules(...code).sort((a, b) => Number(!wreq!.c[a]) - Number(!wreq!.c[b]) || size(a) - size(b))[0];
        if (id == null) return;
        moduleCodeCache.set(key, id);
    }
    try {
        return wreq.c[id]?.exports ?? wreq(id);
    } catch (e) {
        logger.error(`Failed to require module ${id}`, e);
    }
}

/** Returns ids of module factories whose source contains every given string. */
export function searchModules(...code: string[]) {
    if (!wreq) return [];
    return Object.entries(wreq.m)
        .filter(([, f]) => { const s = f.toString(); return code.every(c => s.includes(c)); })
        .map(([id]) => id);
}
