import { version } from "../package.json";

export {
  CAPTCHA_ATTRIBUTES,
  CAPTCHA_CSP,
  CAPTCHA_ENDPOINT,
  CAPTCHA_FIELD,
  CAPTCHA_SOLVER_URL,
  CAPTCHA_STYLE_HASH,
  type CaptchaElement,
  captchaEnabled,
  loadCaptcha,
  resetCaptcha,
} from "./captcha";
export { createClient, type StackClientOptions } from "./client";
export {
  type Content,
  type ContentLabels,
  createContent,
  DEFAULT_LABELS,
  type GetPostsOptions,
  linkHref,
} from "./content";
export {
  type ErrorContext,
  errorEvent,
  parseDsn,
  parseStack,
  reportError,
  type SentryFrame,
  type SentryOptions,
  sendToSentry,
  sentryOptions,
} from "./errors";
export { type ImageAttributes, imageAttributes, imageUrl } from "./media";
export { type Seo, type SeoInput, seo } from "./seo";
export {
  signPreviewToken,
  signWebhook,
  timingSafeEqual,
  type VerifiedWebhook,
  type VerifyWebhookOptions,
  verifyPreviewToken,
  verifySignature,
  verifyWebhook,
  type WebhookPayload,
} from "./signing";
export type * from "./types";

/** The version of this package, the same for every @django-stack package. */
export const VERSION: string = version;
