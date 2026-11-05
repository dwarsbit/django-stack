import { coolify } from "./coolify";
import type { DeployProvider } from "./provider";
import { ssh } from "./ssh";

export * from "./coolify";
export * from "./credentials";
export * from "./link";
export * from "./provider";
export * from "./ssh";

export const DEFAULT_PROVIDER: DeployProvider = coolify;

/** Every deploy provider. */
export const PROVIDERS: DeployProvider[] = [coolify, ssh];

export function getProvider(id: string): DeployProvider {
  const provider = PROVIDERS.find((item) => item.id === id);
  if (!provider)
    throw new Error(
      `Unknown deploy provider ${id}. Choose one of: ${PROVIDERS.map((p) => p.id).join(", ")}.`,
    );
  return provider;
}
