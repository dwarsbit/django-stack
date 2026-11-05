/** The site settings, the menus and whether drafts are shown, for every page. */
export function useLayoutContent() {
  return useFetch("/_content/layout", { key: "layout", dedupe: "defer" });
}
