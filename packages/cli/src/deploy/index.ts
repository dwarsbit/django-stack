import { bunny } from "./bunny";
import { coolify } from "./coolify";
import { dokploy } from "./dokploy";
import type { DeployProvider } from "./provider";
import { ssh } from "./ssh";

export * from "./bunny";
export * from "./bunny-compose";
export * from "./coolify";
export * from "./credentials";
export * from "./dokploy";
export * from "./link";
export * from "./provider";
export * from "./ssh";

export const DEFAULT_PROVIDER: DeployProvider = coolify;

/** Every deploy provider. */
export const PROVIDERS: DeployProvider[] = [coolify, dokploy, ssh, bunny];

export function getProvider(id: string): DeployProvider {
  const provider = PROVIDERS.find((item) => item.id === id);
  if (!provider)
    throw new Error(
      `Unknown deploy provider ${id}. Choose one of: ${PROVIDERS.map((p) => p.id).join(", ")}.`,
    );
  return provider;
}
