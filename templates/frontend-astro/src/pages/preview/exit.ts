import type { APIRoute } from "astro";
import { PREVIEW_COOKIE } from "../../lib/api";

export const GET: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(PREVIEW_COOKIE, { path: "/" });
  return redirect("/", 302);
};
