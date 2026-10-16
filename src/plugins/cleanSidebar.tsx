import type { ReactNode } from "@vibex/react";
import { findModuleByCode } from "../webpack";
import { getPluginSetting, isEnabled } from "./manager";
import { useSettingsVersion } from "./hooks";
import { BooleanItem, Description } from "./settings/components";
import { definePlugin, type CustomSettingApi } from "./types";
import { css } from "../utils/css";

const NAME = "CleanSidebar";
const MORE = "AppTabBar_More_Menu";
const SETTINGS_TAB = "AppTabBar_Settings_Link";

const setting = <T,>(key: string) => getPluginSetting(NAME, key) as T;

/* ------------------------------- left sidebar ------------------------------- */

/** A tab descriptor from X's nav module (the array it renders the sidebar from). */
interface NavItem {
    label?: ReactNode;
    "aria-label"?: string;
    path?: string | { pathname: string };
    testID?: string;
    renderIcon?: unknown;
    renderMenu?: unknown;
    isActive?: boolean;
    [key: string]: unknown;
}

const pathOf = (p: NavItem["path"]) => (typeof p === "string" ? p : p?.pathname);

/** Stable identity for a tab: testID where X sets one, else its route. */
const navKey = (item: NavItem) => item.testID ?? pathOf(item.path) ?? String(item["aria-label"] ?? item.label);

/** Every tab X has rendered this session, for the settings list (key -> label). */
const knownNavItems = new Map<string, string>();

let iconFactory: ((icon: unknown, activeIcon?: unknown) => unknown) | undefined;
let gearIcon: unknown;

function settingsTab(more: NavItem): NavItem {
    gearIcon ??= findModuleByCode("M10.54 1.75h2.92l1.57 2.36")?.default;
    const { renderMenu, isActive, ...rest } = more;
    return {
        ...rest,
        "aria-label": "Settings",
        label: "Settings",
        path: "/settings",
        testID: SETTINGS_TAB,
        renderIcon: iconFactory && gearIcon ? iconFactory(gearIcon) : more.renderIcon,
    };
}

function processNav(items: NavItem[]): NavItem[] {
    for (const item of items) {
        const key = navKey(item);
        if (key !== MORE) knownNavItems.set(key, String(item.label ?? item["aria-label"] ?? key));
    }
    if (!isEnabled(NAME)) return items;

    const hidden = new Set(setting<string[]>("hiddenNav") ?? []);
    const replaceMore = setting<boolean>("hideMoreMenu");
    return items
        .filter(item => !hidden.has(navKey(item)))
        .map(item => (replaceMore && navKey(item) === MORE ? settingsTab(item) : item));
}

/** Re-renders the sidebar whenever VibeX settings change, so toggles apply live. */
function NavFilter({ items, render }: { items: NavItem[]; render(items: NavItem[]): ReactNode }) {
    useSettingsVersion();
    return <>{render(processNav(items))}</>;
}

function NavItemsSetting({ value, set }: CustomSettingApi<string[]>) {
    useSettingsVersion();
    const hidden = new Set(value ?? []);
    if (!knownNavItems.size) return <Description>Sidebar items appear here once X has shown the sidebar.</Description>;

    return <>
        <Description>Sidebar items to hide. The list comes from X itself, so new items show up here automatically.</Description>
        {[...knownNavItems].map(([key, label]) => (
            <BooleanItem
                key={key}
                name={key}
                label={`Hide ${label}`}
                checked={hidden.has(key)}
                onChange={(_, on) => {
                    const next = new Set(hidden);
                    on ? next.add(key) : next.delete(key);
                    set([...next]);
                }}
            />
        ))}
    </>;
}

/* --------------------------------- More menu -------------------------------- */

interface MenuItem { link?: string | { pathname: string }; [key: string]: unknown }

const moreTargets: Record<string, (link: string) => boolean> = {
    hideLists: l => /^\/[^/]+\/lists$/.test(l),
    hideCommunities: l => /^\/[^/]+\/communities$/.test(l),
    hideCreatorStudio: l => l.startsWith("/i/jf/creators"),
    hideBusiness: l => l.startsWith("/i/verified-orgs") || l === "/i/verified" || l.startsWith("/i/premium-business"),
    hideAds: l => /^https:\/\/ads\.(x|twitter)\.com/.test(l),
    hideSpaces: l => l.startsWith("/i/spaces/start"),
};

const childOfMore = (s: Record<string, any>) => !!s.hideMoreMenu;

export default definePlugin({
    name: NAME,
    description: "Hide sidebar items and More menu entries you never use.",
    authors: ["VibeX"],
    enabledByDefault: false,
    settings: {
        hiddenNav: { type: "custom", section: "Sidebar", description: "Sidebar items", default: [] as string[], component: NavItemsSetting },
        hideGrokDrawer: { type: "boolean", section: "Sidebar", description: "Hide the floating Grok button", default: false },
        hideMoreMenu: {
            type: "boolean",
            section: "More menu",
            description: "Hide everything in the More menu and turn the More button into a Settings link",
            default: false,
        },
        hideLists: { type: "boolean", description: "Hide Lists", section: "More menu", default: false, disabled: childOfMore },
        hideCommunities: { type: "boolean", description: "Hide Communities", section: "More menu", default: false, disabled: childOfMore },
        hideCreatorStudio: { type: "boolean", description: "Hide Creator Studio", section: "More menu", default: false, disabled: childOfMore },
        hideBusiness: { type: "boolean", description: "Hide Business", section: "More menu", default: false, disabled: childOfMore },
        hideAds: { type: "boolean", description: "Hide Ads", section: "More menu", default: false, disabled: childOfMore },
        hideSpaces: { type: "boolean", description: "Hide Create your Space", section: "More menu", default: false, disabled: childOfMore },
    },
    patches: [
        {
            // Left nav (module with the More tab): route the tab array through
            // NavFilter. `.map(cb)` on the returned object yields a React element.
            find: `testID:"${MORE}"`,
            replacement: [
                {
                    match: /children:([\w$]+)\.map\(\(([\w$]+),([\w$]+)\)=>\{let\{component:/,
                    replace: "children:$self.wrapNav($1).map(($2,$3)=>{let{component:",
                },
                {
                    // Borrow X's icon helper (Icon, ActiveIcon) => renderIcon from the More tab.
                    match: /rank:([\w$]+)\.rg\.More,renderIcon:\(0,([\w$]+\.[\w$]+)\)\(/,
                    replace: "rank:$1.rg.More,renderIcon:(0,$self.captureIconFactory($2))(",
                },
            ],
        },
        {
            // More menu: the item builder returns {coreItems, countrySpecificItems}.
            // (The same keys also appear in a destructuring pattern; the trailing
            // `})(` only matches the returned object.)
            find: "{coreItems:",
            replacement: {
                match: /,\{coreItems:([\w$]+),countrySpecificItems:([\w$]+)\}\}\)\(/,
                replace: ",$self.filterMoreMenu({coreItems:$1,countrySpecificItems:$2})})(",
            },
        },
    ],

    wrapNav(items: NavItem[]) {
        return { map: (fn: (item: NavItem, i: number) => ReactNode) => <NavFilter items={items} render={list => list.map(fn)} /> };
    },

    captureIconFactory<F extends (...a: any[]) => unknown>(factory: F): F {
        iconFactory = factory;
        return factory;
    },

    filterMoreMenu(menu: { coreItems: MenuItem[]; countrySpecificItems: unknown }) {
        if (!isEnabled(NAME)) return menu;
        const all = setting<boolean>("hideMoreMenu");
        const active = Object.keys(moreTargets).filter(k => all || setting<boolean>(k));
        if (!active.length) return menu;
        return {
            ...menu,
            coreItems: menu.coreItems.filter(item => {
                const link = pathOf(item.link);
                return !link || !active.some(k => moreTargets[k](link));
            }),
        };
    },

    start({ settings, addStyle }) {
        // The floating Grok drawer isn't part of the nav array, so it stays CSS.
        if (settings.hideGrokDrawer) addStyle(css`[data-testid="GrokDrawer"] { display: none !important; }`);
    },
});
