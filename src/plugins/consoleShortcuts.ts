import * as webpack from "../webpack";
import { definePlugin } from "./types";

export default definePlugin({
    name: "ConsoleShortcuts",
    description: "Adds a `vx` object to the DevTools console with webpack helpers for poking at X's internals.",
    authors: ["VibeX"],
    start({ logger }) {
        (window as any).vx = {
            get wreq() { return webpack.wreq; },
            find: webpack.find,
            findAll: (filter: webpack.Filter) => webpack.find(filter, true),
            findByProps: webpack.findByProps,
            findByCode: webpack.findByCode,
            searchModules: webpack.searchModules,
            /** Source of a module factory by id. */
            source: (id: string | number) => webpack.wreq?.m[id]?.toString(),
            filters: webpack.filters,
        };
        logger.info("`vx` is available in the console");
    },
    stop() {
        delete (window as any).vx;
    },
});
