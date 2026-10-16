import type { ReactNode } from "@vibex/react";
import {
    getBooleanItem, getDescription, getPivot, getSettingsScreen, getText,
    type BooleanItemProps, type PivotProps, type SettingsScreenProps, type TextProps,
} from "../../webpack/common";
import { navigate } from "../../utils/router";
import { useXTheme } from "./theme";

// Thin wrappers around X's settings components. If X renames or removes one,
// the wrapper degrades to plain markup instead of crashing the page.

export function Screen(props: SettingsScreenProps) {
    const XScreen = getSettingsScreen();
    const ref = useXTheme();
    const body = <div ref={ref} className="vx-root">{props.children}</div>;
    if (XScreen) return <XScreen {...props}>{body}</XScreen>;
    return (
        <div ref={ref} className="vx-root">
            <div className="vx-fallback-header"><h2 id="detail-header">{props.title}</h2></div>
            {props.children}
        </div>
    );
}

export function Pivot(props: PivotProps) {
    const XPivot = getPivot();
    if (XPivot) return <XPivot {...props} />;
    const href = typeof props.link === "string" ? props.link : props.link?.pathname;
    return (
        <a className="vx-fallback-row" href={href} onClick={e => {
            if (!href) return props.onPress?.();
            e.preventDefault();
            navigate(href);
        }}>
            <div>{props.label}</div>
            {props.description && <div className="vx-value" style={{ textAlign: "left" }}>{props.description}</div>}
        </a>
    );
}

export function BooleanItem(props: BooleanItemProps) {
    const XBool = getBooleanItem();
    if (XBool) return <XBool {...props} />;
    return (
        <label className={`vx-field${props.disabled ? " vx-disabled" : ""}`} style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{props.label}</span>
            <input type="checkbox" checked={props.checked} disabled={props.disabled}
                onChange={e => props.onChange(props.name, e.currentTarget.checked)} />
        </label>
    );
}

export function Description({ children }: { children: ReactNode }) {
    const XDesc = getDescription();
    if (XDesc) return <XDesc description={children} />;
    return <div className="vx-empty">{children}</div>;
}

export function Text(props: TextProps) {
    const XText = getText();
    if (XText) return <XText {...props} />;
    return <span>{props.children}</span>;
}

/* ------------------------------ our own bits ------------------------------ */

export function Icon({ path }: { path: string }) {
    return <svg className="vx-icon" viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg>;
}

export function Tag({ children, warn }: { children: ReactNode; warn?: boolean }) {
    return <span className={`vx-tag${warn ? " vx-warn" : ""}`}>{children}</span>;
}

export function Button({ kind, onClick, children }: { kind?: "primary" | "danger"; onClick(): void; children: ReactNode }) {
    return <button type="button" className={`vx-btn${kind ? ` vx-${kind}` : ""}`} onClick={onClick}>{children}</button>;
}

export function ReloadBanner() {
    return (
        <div className="vx-banner">
            <span>Some changes need a reload of X to take effect.</span>
            <Button kind="primary" onClick={() => location.reload()}>Reload</Button>
        </div>
    );
}

/** Read-only "label ……… value" row in X's pivot style. */
export function InfoRow({ label, value }: { label: string; value: ReactNode }) {
    return <Pivot label={label} withoutArrow renderRightContent={() => <span className="vx-value">{value}</span>} />;
}
