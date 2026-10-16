/**
 * Marks a template literal as CSS. At runtime it just joins the template; in
 * production builds the build script minifies every `css` template and drops
 * the tag (see build.mjs), so it costs nothing.
 */
export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
    return strings.reduce((out, s, i) => out + s + (i < values.length ? String(values[i]) : ""), "");
}
