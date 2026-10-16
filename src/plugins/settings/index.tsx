import type { ComponentType } from "@vibex/react";
import { getRouter } from "../../webpack/common";
import { definePlugin } from "../types";
import { AboutPage, BASE, HomePage, PluginPage, PluginsPage } from "./pages";
import { css } from "./styles";

/** Shape of an entry in X's settings route table (see the patch below). */
interface SettingsRoute {
    getRoute(path: string): unknown;
    id: string;
    isSearchable: boolean;
    path: string;
    synonyms: string[];
    title: string;
    items?: SettingsRoute[];
}

function route(id: string, path: string, title: string, Page: ComponentType<any>, searchable = true): SettingsRoute {
    return {
        id,
        path,
        title,
        isSearchable: searchable,
        synonyms: [],
        getRoute: p => {
            const { Route } = getRouter()!;
            return <Route key={p} exact path={p} component={Page} />;
        },
    };
}

export default definePlugin({
    name: "Settings",
    description: "Adds the VibeX section to X's settings page.",
    authors: ["VibeX"],
    required: true,
    css,
    patches: [
        {
            // X's settings navigation (bundle.Settings) has two variants of the
            // section list; insert our entry right after "Additional resources"
            // in both so React renders it natively.
            find: 'testID:"helpCenterLink"',
            replacement: {
                match: /\(0,([\w$]+)\.jsx\)\(([\w$]+\.[\w$]+),\{label:[\w$]+,link:"\/settings\/about",testID:[\w$]+\}\)/g,
                replace: '$&,(0,$1.jsx)($2,{label:"VibeX",link:"/settings/vibex",testID:"vibexLink"})',
            },
        },
        {
            // X's settings route table: a function that builds every section
            // (with `getRoute`, search title/synonyms and sub-items) and returns
            // it. Appending ours gives VibeX real routes and settings search.
            find: "getRoute:",
            replacement: {
                match: /return ([\w$]+)\}function ([\w$]+)\(\{delegateRole:/,
                replace: "return $self.addRoutes($1)}function $2({delegateRole:",
            },
        },
    ],

    addRoutes(sections: SettingsRoute[]) {
        try {
            if (!getRouter() || sections.some(s => s.id === "VibeX")) return sections;
            sections.push({
                ...route("VibeX", BASE, "VibeX", HomePage),
                synonyms: ["vibex", "mod", "plugins"],
                items: [
                    route("VibeXAbout", `${BASE}/about`, "About VibeX", AboutPage),
                    route("VibeXPlugins", `${BASE}/plugins`, "VibeX plugins", PluginsPage),
                    route("VibeXPlugin", `${BASE}/plugins/:name`, "VibeX plugin", PluginPage, false),
                ],
            });
        } catch (e) {
            // Never take X's settings down with us.
            console.error("[VibeX] Failed to add settings routes", e);
        }
        return sections;
    },
});
