import { redirect } from "@sveltejs/kit";
import { PREVIEW_COOKIE } from "#lib/server/api.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ cookies }) => {
  cookies.delete(PREVIEW_COOKIE, { path: "/" });
  redirect(302, "/");
};
