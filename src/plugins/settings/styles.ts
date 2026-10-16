// Only our own controls need CSS; everything else is X's components.
export const css = `
.vx-root {
    font-family: TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: var(--vx-text);
    font-size: 15px;
    line-height: 20px;
}
.vx-root * { box-sizing: border-box; }
.vx-icon { width: 24px; height: 24px; fill: currentColor; color: var(--vx-muted); display: block; }
.vx-value { color: var(--vx-muted); font-size: 15px; text-align: right; font-variant-numeric: tabular-nums; }
.vx-buttons { display: flex; flex-wrap: wrap; gap: 12px; padding: 12px 16px 24px; }
.vx-btn {
    font: inherit; font-weight: 700; font-size: 15px;
    min-height: 36px; padding: 0 16px; border-radius: 999px; cursor: pointer;
    border: 1px solid var(--vx-border-strong); background: transparent; color: var(--vx-text);
    transition: background-color .2s;
}
.vx-btn:hover { background: var(--vx-hover-strong); }
.vx-btn.vx-primary { background: var(--vx-text); color: var(--vx-bg); border-color: transparent; }
.vx-btn.vx-primary:hover { opacity: .9; }
.vx-btn.vx-danger { color: rgb(244, 33, 46); border-color: rgba(244, 33, 46, .5); }
.vx-btn.vx-danger:hover { background: rgba(244, 33, 46, .1); }
.vx-field { display: grid; gap: 6px; padding: 12px 16px; }
.vx-field label { font-size: 15px; }
.vx-field.vx-disabled label { color: var(--vx-muted); }
.vx-input, .vx-select {
    width: 100%; font: inherit; color: var(--vx-text); background: var(--vx-bg);
    border: 1px solid var(--vx-border-strong); border-radius: 4px; padding: 8px 10px; outline: none;
}
.vx-input:focus, .vx-select:focus { border-color: var(--vx-accent); box-shadow: 0 0 0 1px var(--vx-accent); }
.vx-banner {
    margin: 12px 16px; padding: 12px 16px; border-radius: 12px;
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    background: rgba(29, 155, 240, .1); border: 1px solid rgba(29, 155, 240, .4);
    font-size: 14px;
}
.vx-tag {
    display: inline-block; vertical-align: middle; margin-left: 6px;
    font-size: 11px; line-height: 16px; font-weight: 700; padding: 0 6px; border-radius: 4px;
    background: var(--vx-hover-strong); color: var(--vx-muted);
}
.vx-tag.vx-warn { background: rgba(255, 212, 0, .15); color: rgb(255, 212, 0); }
.vx-subhead {
    margin: 0; padding: 16px 16px 4px; font-size: 20px; line-height: 24px; font-weight: 800;
    border-top: 1px solid var(--vx-border);
}
.vx-empty { padding: 16px; color: var(--vx-muted); font-size: 14px; }

/* Fallback frame, only used if X's SettingsScreen can't be found. */
.vx-fallback-header { height: 53px; padding: 0 16px; display: flex; align-items: center; }
.vx-fallback-header h2 { margin: 0; font-size: 20px; font-weight: 700; }
.vx-fallback-row { display: block; padding: 12px 16px; color: inherit; text-decoration: none; }
.vx-fallback-row:hover { background: var(--vx-hover); }
`;
