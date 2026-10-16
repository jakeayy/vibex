import { useMemo, useState } from "@vibex/react";
import { addSwitchResolver, withValue } from "../core/featureSwitches";
import { getStore } from "../webpack/common";
import { getPluginSetting, isEnabled, setPluginSetting } from "./manager";
import { useSettingsVersion } from "./hooks";
import { Description } from "./settings/components";
import { definePlugin, type CustomSettingApi } from "./types";
import { css } from "../utils/css";

const NAME = "Experiments";
const PAGE_SIZE = 50;

type Overrides = Record<string, unknown>;
const overrides = (): Overrides => (getPluginSetting(NAME, "overrides") as Overrides) ?? {};

// Registered at load: X reads switches from its first render.
addSwitchResolver((name, result) => {
    if (!isEnabled(NAME)) return result;
    const o = overrides();
    return name in o ? withValue(result, o[name]) : result;
});

interface Switch {
    name: string;
    server: unknown;
    yours: unknown;
}

/** Every switch X knows about, with the server default and your account's value. */
function readSwitches(): Switch[] {
    const fs = getStore()?.getState().featureSwitch;
    if (!fs) return [];
    const defaults = fs.defaultConfig ?? {}, user = fs.user?.config ?? {};
    const names = new Set([...Object.keys(defaults), ...Object.keys(user)]);
    return [...names].sort().map(name => ({
        name,
        server: defaults[name]?.value,
        yours: name in user ? user[name]?.value : defaults[name]?.value,
    }));
}

const show = (v: unknown) => (v === undefined ? "—" : JSON.stringify(v));

function SwitchRow({ sw, value, set }: { sw: Switch; value: Overrides; set(v: Overrides): void }) {
    const overridden = sw.name in value;
    const update = (next: unknown | undefined) => {
        const copy = { ...value };
        if (next === undefined) delete copy[sw.name];
        else copy[sw.name] = next;
        set(copy);
    };

    let control;
    if (typeof sw.yours === "boolean" || typeof value[sw.name] === "boolean") {
        const current = overridden ? (value[sw.name] ? "on" : "off") : "default";
        control = (
            <select className="vx-select" value={current} aria-label={sw.name}
                onChange={e => update(e.currentTarget.value === "default" ? undefined : e.currentTarget.value === "on")}>
                <option value="default">Default</option>
                <option value="on">On</option>
                <option value="off">Off</option>
            </select>
        );
    } else {
        control = (
            <input className="vx-input" defaultValue={overridden ? JSON.stringify(value[sw.name]) : ""}
                placeholder="Default (JSON value to override)" aria-label={sw.name}
                onBlur={e => {
                    const text = e.currentTarget.value.trim();
                    if (!text) return update(undefined);
                    try { update(JSON.parse(text)); } catch { e.currentTarget.setCustomValidity("Not valid JSON"); e.currentTarget.reportValidity(); }
                }} />
        );
    }

    return (
        <div className="vx-field vx-switch-row">
            <label className="vx-mono">{sw.name}{overridden && <span className="vx-tag vx-warn">Overridden</span>}</label>
            <div className="vx-value" style={{ textAlign: "left" }}>
                {`Server default: ${show(sw.server)} · Your account: ${show(sw.yours)}`}
            </div>
            {control}
        </div>
    );
}

function SwitchList({ value, set }: CustomSettingApi<Overrides>) {
    useSettingsVersion();
    const all = useMemo(readSwitches, []);
    const [query, setQuery] = useState("");
    const [onlyOverridden, setOnlyOverridden] = useState(false);
    const [limit, setLimit] = useState(PAGE_SIZE);
    const current = value ?? {};

    const q = query.trim().toLowerCase();
    const matches = all.filter(sw => (!q || sw.name.includes(q)) && (!onlyOverridden || sw.name in current));
    const count = Object.keys(current).length;

    if (!all.length) return <Description>Couldn't read X's feature switches.</Description>;

    return <>
        <Description>
            {`${all.length} switches. These are X's own internal flags with no official descriptions; overriding them can break things. Changes apply after a reload.`}
        </Description>
        <div className="vx-field">
            <input className="vx-input" type="search" placeholder="Search switches" value={query}
                onChange={e => { setQuery(e.currentTarget.value); setLimit(PAGE_SIZE); }} />
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={onlyOverridden} onChange={e => setOnlyOverridden(e.currentTarget.checked)} />
                {`Only overridden (${count})`}
            </label>
            {count > 0 && <button type="button" className="vx-btn vx-danger" style={{ justifySelf: "start" }}
                onClick={() => { if (confirm(`Remove all ${count} overrides?`)) set({}); }}>Reset all overrides</button>}
        </div>
        {matches.slice(0, limit).map(sw => <SwitchRow key={sw.name} sw={sw} value={current} set={set} />)}
        {matches.length > limit && (
            <div className="vx-buttons">
                <button type="button" className="vx-btn" onClick={() => setLimit(limit + PAGE_SIZE)}>
                    {`Show more (${matches.length - limit} left)`}
                </button>
            </div>
        )}
        {!matches.length && <div className="vx-empty">No switches match.</div>}
    </>;
}

export default definePlugin({
    name: NAME,
    description: "Browse and override X's feature switches (experiments).",
    authors: ["VibeX"],
    css: css`.vx-mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 13px !important; overflow-wrap: anywhere; }
.vx-switch-row { border-top: 1px solid var(--vx-border); }`,
    settings: {
        overrides: {
            type: "custom",
            description: "Feature switches",
            default: {} as Overrides,
            restartNeeded: true,
            component: SwitchList,
        },
    },
    /** For the console: VibeX.plugins.get("Experiments").setOverride("name", true) */
    setOverride(name: string, value: unknown) {
        const next = { ...overrides() };
        if (value === undefined) delete next[name];
        else next[name] = value;
        setPluginSetting(NAME, "overrides", next);
    },
});
