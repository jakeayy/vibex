import { Fragment, useState } from "@vibex/react";
import * as webpack from "../../webpack";
import { listPlugins, getPluginSetting, setPluginEnabled, setPluginSetting } from "../manager";
import { useSettingsVersion } from "../hooks";
import type { PluginDef, PluginSetting } from "../types";
import { BooleanItem, Button, Description, Icon, InfoRow, Pivot, ReloadBanner, Screen, Tag, Text } from "./components";
import { icons } from "./icons";

export const BASE = "/settings/vibex";

/** Props X's router passes to route components. */
interface RouteProps {
    location: unknown;
    match: { params: Record<string, string> };
}

export function HomePage({ location }: RouteProps) {
    return (
        <Screen location={location} title="VibeX" screenType="primaryDetail">
            <Description>VibeX is a client mod for X. Manage its plugins and see what it's doing under the hood.</Description>
            <Pivot
                label="About VibeX"
                description="Version, build info and the status of the mod's internals."
                link={`${BASE}/about`}
                thumbnail={<Icon path={icons.info} />}
            />
            <Pivot
                label="Plugins"
                description="Turn features on and off and change their settings."
                link={`${BASE}/plugins`}
                thumbnail={<Icon path={icons.plugin} />}
            />
        </Screen>
    );
}

export function AboutPage({ location }: RouteProps) {
    const plugins = listPlugins();
    const modules = webpack.wreq ? Object.keys(webpack.wreq.m).length : 0;
    const loaded = webpack.wreq ? Object.keys(webpack.wreq.c).length : 0;
    const unapplied = webpack.unappliedPatches();
    const [copied, setCopied] = useState<string | null>(null);

    const copyDebug = async () => {
        const info = {
            version: VIBEX_VERSION,
            build: VIBEX_BUILD_TIME,
            userAgent: navigator.userAgent,
            webpack: {
                hookedEarly: webpack.hookedEarly, modules, loaded, ...webpack.stats,
                unapplied: unapplied.map(p => ({ plugin: p.plugin, find: String(p.find) })),
            },
            plugins: plugins.map(p => ({ name: p.def.name, enabled: p.enabled, running: p.running })),
        };
        try {
            await navigator.clipboard.writeText(JSON.stringify(info, null, 2));
            setCopied("Copied!");
        } catch {
            setCopied("Copy failed");
        }
        setTimeout(() => setCopied(null), 1500);
    };

    return (
        <Screen location={location} title="About VibeX" screenType="secondaryDetail" backLocation={BASE}>
            <Description>
                VibeX runs entirely in your browser as a userscript. It doesn't send anything anywhere;
                all of its settings are stored in this browser's localStorage.
            </Description>
            <InfoRow label="Version" value={VIBEX_VERSION} />
            <InfoRow label="Built" value={new Date(VIBEX_BUILD_TIME).toLocaleString()} />
            <InfoRow label="Plugins enabled" value={`${plugins.filter(p => p.enabled).length} / ${plugins.length}`} />

            <h3 className="vx-subhead">Internals</h3>
            <InfoRow label="Webpack hook" value={webpack.hookedEarly ? "Early (patches active)" : "Late (patches unavailable)"} />
            <InfoRow label="Webpack modules" value={`${loaded} loaded / ${modules} known`} />
            <InfoRow label="Patches applied" value={String(webpack.stats.patched.length)} />
            {unapplied.length > 0 && (
                <InfoRow label="Patches not applied" value={unapplied.map(p => p.plugin).join(", ")} />
            )}
            {webpack.stats.failed.length > 0 && <InfoRow label="Patches failed" value={String(webpack.stats.failed.length)} />}

            <div className="vx-buttons">
                <Button kind="primary" onClick={() => window.location.reload()}>Reload X</Button>
                <Button onClick={copyDebug}>{copied ?? "Copy debug info"}</Button>
                <Button kind="danger" onClick={() => {
                    if (!confirm("Reset all VibeX settings to their defaults? X will reload.")) return;
                    localStorage.removeItem("vibex:settings");
                    window.location.reload();
                }}>Reset settings</Button>
            </div>
        </Screen>
    );
}

export function PluginsPage({ location }: RouteProps) {
    useSettingsVersion();
    const plugins = listPlugins().sort((a, b) =>
        Number(!!b.def.required) - Number(!!a.def.required) || a.def.name.localeCompare(b.def.name));

    return (
        <Screen location={location} title="Plugins" screenType="secondaryDetail" backLocation={BASE}>
            <Description>Pick a plugin to turn it on or off and change its settings.</Description>
            {plugins.some(p => p.needsReload) && <ReloadBanner />}
            {plugins.map(({ def, enabled, needsReload }) => (
                <Pivot
                    key={def.name}
                    link={`${BASE}/plugins/${encodeURIComponent(def.name)}`}
                    // Pivot only wraps plain-string labels in X's Text; anything
                    // richer must bring its own, or it inherits the <a>'s link colours.
                    label={<Text>
                        {def.name}
                        {def.required && <Tag>Required</Tag>}
                        {needsReload && <Tag warn>Reload needed</Tag>}
                    </Text>}
                    description={def.description}
                    renderRightContent={() => <span className="vx-value">{enabled ? "On" : "Off"}</span>}
                />
            ))}
        </Screen>
    );
}

function SettingControl({ plugin, name, setting, values }: {
    plugin: PluginDef; name: string; setting: PluginSetting; values: Record<string, any>;
}) {
    const value = values[name];
    const set = (v: unknown) => setPluginSetting(plugin.name, name, v);
    const disabled = !!setting.disabled?.(values);

    switch (setting.type) {
        case "custom": {
            const Custom = setting.component;
            return <Custom value={value} set={set} />;
        }
        case "boolean":
            return <BooleanItem name={name} label={setting.description} checked={!!value} disabled={disabled} onChange={(_, v) => set(v)} />;
        case "select":
            return (
                <div className={`vx-field${disabled ? " vx-disabled" : ""}`}>
                    <label>{setting.description}</label>
                    <select className="vx-select" value={value} disabled={disabled} onChange={e => set(e.currentTarget.value)}>
                        {setting.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                </div>
            );
        case "string":
        case "number":
            return (
                <div className={`vx-field${disabled ? " vx-disabled" : ""}`}>
                    <label>{setting.description}</label>
                    <input
                        className="vx-input"
                        type={setting.type === "number" ? "number" : "text"}
                        defaultValue={String(value ?? "")}
                        disabled={disabled}
                        placeholder={setting.type === "string" ? setting.placeholder : undefined}
                        min={setting.type === "number" ? setting.min : undefined}
                        max={setting.type === "number" ? setting.max : undefined}
                        onBlur={e => set(setting.type === "number" ? Number(e.currentTarget.value) : e.currentTarget.value)}
                    />
                </div>
            );
    }
}

export function PluginPage({ location, match }: RouteProps) {
    useSettingsVersion();
    const name = decodeURIComponent(match.params.name ?? "");
    const info = listPlugins().find(p => p.def.name === name);

    if (!info) {
        return (
            <Screen location={location} title="Plugin not found" screenType="secondaryDetail" backLocation={`${BASE}/plugins`}>
                <Description>{`There's no VibeX plugin called "${name}".`}</Description>
            </Screen>
        );
    }

    const { def, enabled, needsReload } = info;
    const settings = Object.entries(def.settings ?? {});
    const values = Object.fromEntries(settings.map(([k]) => [k, getPluginSetting(def.name, k)]));

    return (
        <Screen location={location} title={def.name} screenType="secondaryDetail" backLocation={`${BASE}/plugins`}>
            {/* One string: X's Description pads each child separately, so split text wraps unpadded. */}
            <Description>
                {`${def.description} By ${def.authors.join(", ")}.`
                    + (def.patches?.length ? " This plugin patches X's code, so turning it on or off needs a reload." : "")}
            </Description>
            {needsReload && <ReloadBanner />}
            <BooleanItem
                name="enabled"
                label="Enabled"
                helpText={def.required ? "This plugin is required by VibeX and can't be turned off." : undefined}
                checked={enabled}
                disabled={def.required}
                onChange={(_, v) => setPluginEnabled(def.name, v)}
            />
            {settings.map(([key, setting], i) => {
                const section = setting.section ?? "Settings";
                const heading = i === 0 || section !== (settings[i - 1][1].section ?? "Settings");
                return <Fragment key={key}>
                    {heading && <h3 className="vx-subhead">{section}</h3>}
                    <SettingControl plugin={def} name={key} setting={setting} values={values} />
                </Fragment>;
            })}
        </Screen>
    );
}
