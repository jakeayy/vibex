// X's React instance, resolved lazily from webpack. Import hooks from here
// (`import { useState } from "@vibex/react"`), never from "react" itself:
// React is not bundled, and a second copy would break hooks.
import type * as ReactTypes from "react";
import { find, filters } from "..";

let react: typeof ReactTypes | undefined;

export function getReact(): typeof ReactTypes {
    react ??= find(filters.byProps("useState", "useEffect", "createElement", "Fragment"));
    if (!react) throw new Error("VibeX: X's React is not loaded yet");
    return react;
}

const lazy = <K extends keyof typeof ReactTypes>(key: K) =>
    ((...args: any[]) => (getReact()[key] as any)(...args)) as (typeof ReactTypes)[K];

export const useState = lazy("useState");
export const useEffect = lazy("useEffect");
export const useLayoutEffect = lazy("useLayoutEffect");
export const useMemo = lazy("useMemo");
export const useCallback = lazy("useCallback");
export const useRef = lazy("useRef");
export const useReducer = lazy("useReducer");
export const useSyncExternalStore = lazy("useSyncExternalStore");
export const createElement = lazy("createElement");

export const Fragment = Symbol.for("react.fragment") as unknown as typeof ReactTypes.Fragment;

export type { ReactNode, ComponentType, FC, CSSProperties } from "react";
