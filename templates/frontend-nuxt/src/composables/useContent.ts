import { safeHref } from "@django-stack/utils";
import type { NitroFetchRequest } from "nitropack";

/**
 * Content from a route in server/routes/_content. When it is not found, a
 * redirect that editors manage in the admin is followed; otherwise the error
 * page shows with the status, such as 404.
 */
export async function useContent<R extends NitroFetchRequest>(url: R, query?: () => Record<string, unknown>) {
  const nuxtApp = useNuxtApp();
  const route = useRoute();
  const result = await useFetch(url, { query: computed(() => query?.() ?? {}) });
  const error = result.error.value;
  if (error) {
    const statusCode = error.statusCode ?? 500;
    if (statusCode === 404) {
      const target = await $fetch("/_content/redirect", { query: { path: route.path } }).catch(() => null);
      if (target) {
        // A redirect may go to a full URL; Nuxt only follows those with `external`.
        const location = safeHref(target.new_path);
        const external = /^([a-z][a-z0-9+.-]*:|\/\/)/i.test(location);
        await nuxtApp.runWithContext(() =>
          navigateTo(location, { redirectCode: target.permanent ? 301 : 302, external }),
        );
        return result;
      }
    }
    throw createError({ statusCode, statusMessage: error.statusMessage, fatal: true });
  }
  return result;
}
