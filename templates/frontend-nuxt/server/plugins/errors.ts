import { reportError } from "@django-stack/utils";

/** Server errors go to Sentry with ERRORS=sentry; Nuxt logs them as well. */
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("error", async (error, { event }) => {
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status < 500) return;
    await reportError(error, {
      method: event?.method,
      path: event?.path,
      requestId: event?.headers.get("x-request-id"),
    });
  });
});
