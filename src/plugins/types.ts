import type { ComponentType } from "react";
import type { Patch } from "../webpack";
import type { Logger } from "../utils/logger";

interface SettingBase<T> {
    description: string;
    default: T;
    /** Changing this setting only takes effect after reloading X. */
    restartNeeded?: boolean;
    /** Groups consecutive settings under a heading on the plugin page. */
    section?: string;
    /** Greys the control out, e.g. when a parent option already covers it. */
    disabled?(settings: Record<string, any>): boolean;
}

export interface CustomSettingApi<T> {
    value: T;
    set(value: T): void;
}

export type PluginSetting =
    | ({ type: "boolean" } & SettingBase<boolean>)
    | ({ type: "string"; placeholder?: string } & SettingBase<string>)
    | ({ type: "number"; min?: number; max?: number } & SettingBase<number>)
    | ({ type: "select"; options: { label: string; value: string }[] } & SettingBase<string>)
    /** Plugin renders its own control, e.g. for lists that are only known at runtime. */
    | ({ type: "custom"; component: ComponentType<CustomSettingApi<any>> } & SettingBase<any>);

export type SettingValue<S extends PluginSetting> = S["default"];

export interface PluginContext<S extends Record<string, PluginSetting>> {
    logger: Logger;
    /** Live view of this plugin's settings (reads always return the current value). */
    settings: { [K in keyof S]: SettingValue<S[K]> };
    /** Inject CSS that is removed automatically when the plugin stops. */
    addStyle(css: string): void;
    /** Register a cleanup function that runs when the plugin stops. */
    onStop(fn: () => void): void;
}

export interface PluginDef<S extends Record<string, PluginSetting> = Record<string, PluginSetting>> {
    name: string;
    description: string;
    authors: string[];
    /** Can't be disabled (core functionality). */
    required?: boolean;
    enabledByDefault?: boolean;
    /**
     * Start at document-start instead of DOMContentLoaded, before X's bundles
     * run (e.g. to intercept X's first network requests). No DOM is available yet.
     */
    startEarly?: boolean;
    settings?: S;
    /** Extra content on the plugin's settings page, above its settings (e.g. live stats). */
    settingsPanel?: ComponentType;
    /** Static CSS applied while the plugin is enabled. */
    css?: string;
    /** Webpack source patches. Applied at page load only, so toggling needs a reload. */
    patches?: Omit<Patch, "plugin">[];
    start?(ctx: PluginContext<S>): void;
    stop?(ctx: PluginContext<S>): void;
    /** Called on every in-app navigation while enabled. */
    onRouteChange?(path: string, ctx: PluginContext<S>): void;
    [extra: string]: unknown;
}

/** Identity helper that gives plugin authors full type inference for their settings. */
export function definePlugin<S extends Record<string, PluginSetting>>(def: PluginDef<S> & ThisType<PluginDef<S>>) {
    return def;
}
