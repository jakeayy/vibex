const BADGE = "background:#1d9bf0;color:#fff;border-radius:4px;padding:1px 6px;font-weight:700";

export class Logger {
    constructor(private readonly name: string, private readonly color = "#a78bfa") {}

    private print(level: "log" | "info" | "warn" | "error" | "debug", args: unknown[]) {
        console[level](
            `%cVibeX%c %c${this.name}`,
            BADGE,
            "",
            `color:${this.color};font-weight:600`,
            ...args,
        );
    }

    log(...args: unknown[]) { this.print("log", args); }
    info(...args: unknown[]) { this.print("info", args); }
    warn(...args: unknown[]) { this.print("warn", args); }
    error(...args: unknown[]) { this.print("error", args); }
    debug(...args: unknown[]) { this.print("debug", args); }
}
