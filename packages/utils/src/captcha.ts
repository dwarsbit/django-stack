/**
 * The captcha of DjangoStack: the `<cap-widget>` web component of
 * `@cap.js/widget`, talking to `django_stack.contrib.captcha` on the same
 * site. The widget puts its token in a hidden `captcha` field of the form,
 * which the public create routes check.
 */

/** Where Django serves the Cap protocol. */
export const CAPTCHA_ENDPOINT = "/api/cap/";

/** The form field with the token, as the API expects it. */
export const CAPTCHA_FIELD = "captcha";

/** The widget's WebAssembly solver, served by Django so nothing loads from a CDN. */
export const CAPTCHA_SOLVER_URL = "/api/cap/solver.wasm";

/**
 * The hash of the `<style>` the widget adds to its shadow root, for the
 * `style-src` of a Content-Security-Policy. It changes with the version of
 * `@cap.js/widget`, which is pinned for that reason.
 */
export const CAPTCHA_STYLE_HASH = "'sha256-wztaw4JykxcHsDODFshiqt3woVAWzD4k5Zi3KJI3B5U='";

/**
 * What a Content-Security-Policy must allow for the widget, by directive:
 * its style, its solver (WebAssembly) and its workers (blob URLs).
 */
export const CAPTCHA_CSP: Readonly<Record<"script-src" | "style-src" | "worker-src", readonly string[]>> = {
  "script-src": ["'wasm-unsafe-eval'"],
  "style-src": [CAPTCHA_STYLE_HASH],
  "worker-src": ["'self'", "blob:"],
};

/** The attributes of the `<cap-widget>` element. */
export const CAPTCHA_ATTRIBUTES: Readonly<Record<string, string>> = {
  "data-cap-api-endpoint": CAPTCHA_ENDPOINT,
  "data-cap-hidden-field-name": CAPTCHA_FIELD,
};

/** Whether the captcha is on: the CAPTCHA environment variable is not `off`. */
export function captchaEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "off";
}

let loading: Promise<void> | undefined;

/**
 * Defines the `<cap-widget>` element in the browser, with its solver from
 * this site. Call it on the client only; it does nothing on the server.
 */
export function loadCaptcha(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  window.CAP_CUSTOM_WASM_URL ??= CAPTCHA_SOLVER_URL;
  loading ??= import("@cap.js/widget").then(() => undefined);
  return loading;
}

/** A widget element, for `resetCaptcha`. */
export interface CaptchaElement extends HTMLElement {
  reset(): void;
}

/** Clears the token of the widgets in `root`, after a submission used it. */
export function resetCaptcha(root: ParentNode): void {
  root.querySelectorAll<CaptchaElement>("cap-widget").forEach((widget) => {
    widget.reset?.();
  });
}
