// Handles to X's own modules (router + settings UI components). Each is
// located by strings in its source rather than by module id, since ids and
// minified names change between X deploys. Lookups are lazy and cached.
import type { ComponentType, ReactNode } from "react";
import { filters, find, findModuleByCode } from ".";
import { Logger } from "../utils/logger";

const logger = new Logger("Common", "#f59e0b");

function lazyValue<T>(name: string, get: () => T | undefined): () => T | undefined {
    let cached: T | undefined;
    let warned = false;
    return () => {
        if (cached) return cached;
        cached = get();
        if (!cached && !warned) {
            warned = true;
            logger.warn(`Could not find ${name}; X may have changed it`);
        }
        return cached;
    };
}

/** First export of a module that looks like a React component. */
function componentExport(mod: any): ComponentType<any> | undefined {
    if (!mod) return;
    for (const v of Object.values(mod)) if (typeof v === "function" || (typeof v === "object" && v && "$$typeof" in v)) return v as any;
}

/* ---------------------------------- router ---------------------------------- */

export interface RouterModule {
    Route: ComponentType<any>;
    Switch: ComponentType<any>;
    Redirect: ComponentType<any>;
    useHistory(): { push(path: string | object): void; replace(path: string | object): void; goBack(): void; location: Location };
    useLocation(): { pathname: string; search: string; state?: unknown };
    useParams<T = Record<string, string>>(): T;
}

export const getRouter = lazyValue<RouterModule>("react-router", () => find(filters.byProps("Route", "Switch", "withRouter", "useHistory")));

/* ------------------------------- X components ------------------------------- */

export interface SettingsScreenProps {
    location: unknown;
    title: string;
    screenType?: "root" | "primaryDetail" | "secondaryDetail";
    backLocation?: string;
    children?: ReactNode;
}

export interface PivotProps {
    label: ReactNode;
    description?: ReactNode;
    link?: string | { pathname: string; external?: boolean };
    onPress?(): void;
    withoutArrow?: boolean;
    disabled?: boolean;
    thumbnail?: ReactNode;
    renderRightContent?(): ReactNode;
    testID?: string;
}

export interface BooleanItemProps {
    checked: boolean;
    label: ReactNode;
    name: string;
    onChange(name: string, checked: boolean): void;
    helpText?: ReactNode;
    disabled?: boolean;
    type?: "checkbox" | "toggle";
    testID?: string;
}

export interface TextProps {
    children?: ReactNode;
    color?: "text" | "gray700" | "primary" | "red500" | string;
    size?: "headline1" | "headline2" | "body" | "subtext1" | "subtext2" | string;
    weight?: "normal" | "medium" | "bold" | "heavy";
    link?: string;
}

/** Settings page frame: sticky app bar with title/back button + scroll container. */
export const getSettingsScreen = lazyValue<ComponentType<SettingsScreenProps>>("SettingsScreen",
    () => componentExport(findModuleByCode("_renderWithFetchSettings", "getBackLocation")));

/** "Label / description / ›" row used across X's settings. */
export const getPivot = lazyValue<ComponentType<PivotProps>>("Pivot",
    () => componentExport(findModuleByCode('testID:E="pivot"')) ?? componentExport(findModuleByCode('"pivot"', "-description", "withoutArrow")));

/** Checkbox / switch row used across X's settings. */
export const getBooleanItem = lazyValue<ComponentType<BooleanItemProps>>("BooleanItem",
    () => componentExport(findModuleByCode("_renderHelpText", "withCompactPaddingVertical")));

/** Grey explanatory paragraph at the top of settings pages. */
export const getDescription = lazyValue<ComponentType<{ description: ReactNode }>>("SettingsDescription",
    () => componentExport(findModuleByCode("_renderLearnMore", "learnMoreLink", "gutterVertical")));

/** X's base Text component (module exports it as `Ay`). */
export const getText = lazyValue<ComponentType<TextProps>>("Text", () => {
    const mod = findModuleByCode("withoutTwemojiAndHashflags", "_maybeRenderInteractive");
    return mod?.Ay ?? componentExport(mod);
});
