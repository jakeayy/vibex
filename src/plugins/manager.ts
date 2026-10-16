import { Logger } from "../utils/logger";
import { addStyle, removeStyle } from "../utils/dom";
import { getSettings, saveSettings, type PluginState } from "../utils/storage";
import { onRouteChange } from "../utils/router";
import { addPatch } from "../webpack";
import type { PluginContext, PluginDef } from "./types";

const logger = new Logger("PluginManager", "#34d399");

interface Runtime {
    def: PluginDef;
    ctx: PluginContext<any>;
    running: boolean;
    cleanups: (() => void)[];
    styleIds: string[];
    patchesApplied: boolean;
    /** A `restartNeeded` setting changed since page load. */
    settingsNeedReload: boolean;
}

const registry = new Map<string, Runtime>();

function state(def: PluginDef): PluginState {
    const all = getSettings().plugins;
    const s = (all[def.name] ??= { enabled: !!(def.required || def.enabledByDefault) });
    for (const [key, setting] of Object.entries(def.settings ?? {})) {
        if (!(key in s)) s[key] = setting.default;
    }
    return s;
}

function makeContext(rt: Omit<Runtime, "ctx">): PluginContext<any> {
    const def = rt.def;
    let n = 0;
    return {
        logger: new Logger(def.name),
        settings: new Proxy({}, {
            get: (_, key: string) => state(def)[key],
            set: (_, key: string, value) => { setPluginSetting(def.name, key, value); return true; },
        }) as any,
        addStyle(css) {
            const id = `${def.name}-${n++}`;
            addStyle(id, css);
            rt.styleIds.push(id);
        },
        onStop(fn) {
            rt.cleanups.push(fn);
        },
    };
}

export function registerPlugin(def: PluginDef) {
    if (registry.has(def.name)) throw new Error(`Duplicate plugin name: ${def.name}`);
    const partial = { def, running: false, cleanups: [], styleIds: [], patchesApplied: false, settingsNeedReload: false };
    const rt: Runtime = { ...partial, ctx: null! };
    rt.ctx = makeContext(rt);
    registry.set(def.name, rt);

    // Patches must be registered before X's bundles load, so they're decided
    // by the saved enabled-state at page load.
    if (def.patches?.length && isEnabled(def.name)) {
        def.patches.forEach(p => addPatch({ ...p, plugin: def.name }));
        rt.patchesApplied = true;
    }
}

export function isEnabled(name: string) {
    const rt = registry.get(name);
    return !!rt && (rt.def.required || state(rt.def).enabled);
}

export function startPlugin(name: string) {
    const rt = registry.get(name);
    if (!rt || rt.running) return;
    try {
        if (rt.def.css) rt.ctx.addStyle(rt.def.css);
        rt.def.start?.call(rt.def, rt.ctx);
        rt.running = true;
        logger.info(`Started ${name}`);
    } catch (e) {
        logger.error(`Failed to start ${name}`, e);
    }
}

export function stopPlugin(name: string) {
    const rt = registry.get(name);
    if (!rt || !rt.running) return;
    try {
        rt.def.stop?.call(rt.def, rt.ctx);
    } catch (e) {
        logger.error(`Error while stopping ${name}`, e);
    }
    rt.cleanups.splice(0).forEach(fn => { try { fn(); } catch (e) { logger.error(e); } });
    rt.styleIds.splice(0).forEach(removeStyle);
    rt.running = false;
    logger.info(`Stopped ${name}`);
}

/** Returns true when a page reload is needed for the change to fully apply. */
export function setPluginEnabled(name: string, enabled: boolean): boolean {
    const rt = registry.get(name);
    if (!rt || rt.def.required) return false;
    state(rt.def).enabled = enabled;
    saveSettings();
    if (enabled) startPlugin(name);
    else stopPlugin(name);
    return !!rt.def.patches?.length && rt.patchesApplied !== enabled;
}

export function setPluginSetting(name: string, key: string, value: unknown) {
    const rt = registry.get(name);
    if (!rt) return;
    state(rt.def)[key] = value;
    if (rt.def.settings?.[key]?.restartNeeded) rt.settingsNeedReload = true;
    saveSettings();
    // Simple, predictable semantics: a running plugin restarts to pick up new settings.
    if (rt.running && !rt.def.settings?.[key]?.restartNeeded) {
        stopPlugin(name);
        startPlugin(name);
    }
}

export function getPluginSetting(name: string, key: string) {
    const rt = registry.get(name);
    return rt ? state(rt.def)[key] : undefined;
}

/** Starts enabled `startEarly` plugins; runs at document-start. */
export function startEarlyPlugins() {
    for (const [name, rt] of registry) if (rt.def.startEarly && isEnabled(name)) startPlugin(name);
}

export function startAll() {
    for (const [name] of registry) if (isEnabled(name)) startPlugin(name);
    onRouteChange(path => {
        for (const rt of registry.values()) {
            if (!rt.running || !rt.def.onRouteChange) continue;
            try { rt.def.onRouteChange.call(rt.def, path, rt.ctx); } catch (e) { logger.error(e); }
        }
    });
}

export function listPlugins() {
    return [...registry.values()].map(rt => ({
        def: rt.def,
        running: rt.running,
        enabled: isEnabled(rt.def.name),
        needsReload: (!!rt.def.patches?.length && rt.patchesApplied !== isEnabled(rt.def.name))
            || (rt.settingsNeedReload && isEnabled(rt.def.name)),
    }));
}

export const plugins = {
    get: (name: string) => registry.get(name)?.def,
    list: listPlugins,
    isEnabled,
    setEnabled: setPluginEnabled,
    setSetting: setPluginSetting,
    getSetting: getPluginSetting,
};
