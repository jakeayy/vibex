// JSX runtime shim: esbuild compiles VibeX's .tsx against this module, which
// forwards to X's own react/jsx-runtime pulled out of webpack. Nothing here
// runs until a component actually renders, by which point X's React is loaded.
import { find, filters } from "..";

export type { JSX } from "react/jsx-runtime";

let runtime: any;
const rt = () => (runtime ??= find(filters.byProps("jsx", "jsxs", "Fragment")));

export const Fragment = Symbol.for("react.fragment");

export function jsx(type: any, props: any, key?: any) {
    return rt().jsx(type, props, key);
}

export function jsxs(type: any, props: any, key?: any) {
    return rt().jsxs(type, props, key);
}
