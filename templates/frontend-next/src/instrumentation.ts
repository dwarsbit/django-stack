import { reportError } from "@django-stack/utils";
import type { Instrumentation } from "next";

/** Server errors go to Sentry with ERRORS=sentry; Next.js logs them as well. */
export const onRequestError: Instrumentation.onRequestError = async (error, request) => {
  const id = request.headers["x-request-id"];
  await reportError(error, {
    method: request.method,
    path: request.path,
    requestId: Array.isArray(id) ? id[0] : id,
  });
};
