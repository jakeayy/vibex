import { useCallback } from "@vibex/react";

function rgb(color: string): [number, number, number] | null {
    const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : null;
}

/**
 * X's components theme themselves; our few custom controls (buttons, inputs)
 * get CSS variables derived from X's rendered page instead, so they follow
 * Light / Dim / Lights out as well.
 */
export function applyTheme(el: HTMLElement) {
    const scheme = document.documentElement.style.colorScheme === "light" ? "light" : "dark";
    const bg = rgb(getComputedStyle(document.body).backgroundColor) ?? (scheme === "light" ? [255, 255, 255] : [0, 0, 0]);
    const heading = document.querySelector("#detail-header, #root-header, h2[role=heading]");
    const text = (heading && rgb(getComputedStyle(heading).color)) ?? (scheme === "light" ? [15, 20, 25] : [231, 233, 234]);
    const isDim = scheme === "dark" && bg[2] > 30;
    const muted = scheme === "light" ? [83, 100, 113] : isDim ? [139, 152, 165] : [113, 118, 123];
    const section = el.closest("section");
    const border = (section && rgb(getComputedStyle(section).borderLeftColor)) ?? (scheme === "light" ? [239, 243, 244] : [47, 51, 54]);

    const c = (v: number[], a = 1) => `rgba(${v.join(",")},${a})`;
    Object.entries({
        "--vx-bg": c(bg),
        "--vx-text": c(text),
        "--vx-muted": c(muted),
        "--vx-border": c(border),
        "--vx-border-strong": c(muted, 0.6),
        "--vx-hover": c(text, 0.03),
        "--vx-hover-strong": c(text, 0.1),
        "--vx-accent": "rgb(29,155,240)",
    }).forEach(([k, v]) => el.style.setProperty(k, v));
}

/** Ref callback that themes the element it's attached to. */
export function useXTheme() {
    return useCallback((el: HTMLElement | null) => { if (el) applyTheme(el); }, []);
}
