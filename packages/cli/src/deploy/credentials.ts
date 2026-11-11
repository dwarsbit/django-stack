import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * API keys of deploy providers, never in the project: the OS keychain
 * (macOS Keychain, Windows Credential Manager, the Secret Service on Linux),
 * or a file only the user can read where there is no keychain. An
 * environment variable such as DSTACK_COOLIFY_TOKEN overrides both, for CI.
 */

const SERVICE = "dstack";

export type TokenSource = "env" | "keychain" | "file";

interface Keyring {
  get(account: string): string | undefined;
  set(account: string, token: string): void;
  delete(account: string): void;
}

let keyringOverride: Keyring | null | undefined;

/** Replaces the OS keychain in tests; null means there is none. */
export function setKeyring(keyring: Keyring | null | undefined) {
  keyringOverride = keyring;
}

function systemKeyring(): Keyring | null {
  if (keyringOverride !== undefined) return keyringOverride;
  try {
    const { Entry } = createRequire(import.meta.url)("@napi-rs/keyring") as typeof import("@napi-rs/keyring");
    return {
      get: (account) => new Entry(SERVICE, account).getPassword() ?? undefined,
      set: (account, token) => new Entry(SERVICE, account).setPassword(token),
      delete: (account) => void new Entry(SERVICE, account).deletePassword(),
    };
  } catch {
    // No prebuilt binary for this platform.
    return null;
  }
}

/** The account a key is saved under: one per provider and instance. */
export function accountFor(provider: string, url: string): string {
  return `${provider}:${url}`;
}

export function credentialsFile(): string {
  const base =
    process.env.XDG_CONFIG_HOME ||
    (process.platform === "win32" && process.env.APPDATA) ||
    join(homedir(), ".config");
  return join(base, "dstack", "credentials.json");
}

function readFile(): Record<string, string> {
  const path = credentialsFile();
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeFile(values: Record<string, string>) {
  const path = credentialsFile();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export function getToken(
  provider: string,
  url: string,
  envName: string,
): { token: string; source: TokenSource } | undefined {
  const fromEnv = process.env[envName];
  if (fromEnv) return { token: fromEnv, source: "env" };
  const account = accountFor(provider, url);
  const keyring = systemKeyring();
  if (keyring) {
    try {
      const token = keyring.get(account);
      if (token) return { token, source: "keychain" };
    } catch {}
  }
  const token = readFile()[account];
  return token ? { token, source: "file" } : undefined;
}

/** Saves a key in the keychain, or in the credentials file when there is none. */
export function saveToken(provider: string, url: string, token: string): TokenSource {
  const account = accountFor(provider, url);
  const keyring = systemKeyring();
  if (keyring) {
    try {
      keyring.set(account, token);
      removeFromFile(account);
      return "keychain";
    } catch {
      // A locked or missing Secret Service, such as on a server without a desktop.
    }
  }
  writeFile({ ...readFile(), [account]: token });
  return "file";
}

function removeFromFile(account: string): boolean {
  const values = readFile();
  if (!(account in values)) return false;
  delete values[account];
  writeFile(values);
  return true;
}

/** Removes a key from the keychain and the file; returns whether there was one. */
export function deleteToken(provider: string, url: string): boolean {
  const account = accountFor(provider, url);
  let removed = false;
  const keyring = systemKeyring();
  if (keyring) {
    try {
      if (keyring.get(account)) {
        keyring.delete(account);
        removed = true;
      }
    } catch {}
  }
  return removeFromFile(account) || removed;
}

/**
 * The last target of each provider, such as the Coolify address, so setup
 * and login offer it again. Not a secret: ~/.config/dstack/targets.json.
 */
export function targetsFile(): string {
  return join(dirname(credentialsFile()), "targets.json");
}

function readTargets(): Record<string, string> {
  try {
    const values = JSON.parse(readFileSync(targetsFile(), "utf8")) as unknown;
    return values && typeof values === "object" ? (values as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function lastTarget(provider: string): string | undefined {
  const value = readTargets()[provider];
  return typeof value === "string" && value ? value : undefined;
}

/** Remembers a target; never fails a command over it. */
export function rememberTarget(provider: string, target: string) {
  try {
    const path = targetsFile();
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, `${JSON.stringify({ ...readTargets(), [provider]: target }, null, 2)}\n`);
  } catch {}
}
