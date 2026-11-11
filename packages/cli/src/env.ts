import { chmodSync, writeFileSync } from "node:fs";

/**
 * Writes a file only its owner can read, such as a .env with secrets. The
 * mode of writeFileSync only applies to a new file, so an existing one is
 * tightened as well.
 */
export function writePrivateFile(path: string, text: string) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/** Reads a .env file: KEY=value lines, comments and blank lines ignored. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[trimmed.slice(0, index).trim()] = value;
  }
  return values;
}

/** Sets KEY=value lines in .env text, replacing existing ones and appending new ones. */
export function setEnvValues(text: string, values: Record<string, string>): string {
  let result = text;
  for (const [key, value] of Object.entries(values)) {
    const pattern = new RegExp(`^${key}=.*$`, "m");
    result = pattern.test(result)
      ? result.replace(pattern, () => `${key}=${value}`)
      : `${result.trimEnd()}\n${key}=${value}\n`;
  }
  return result;
}

/**
 * A value as Docker Compose reads it literally: single-quoted when it has
 * characters Compose would interpolate or cut, such as `$`, `#` or a
 * space at either end.
 * Throws for a value it cannot quote.
 */
export function quoteEnvValue(value: string): string {
  if (/[\r\n]/.test(value)) throw new Error("A value can't have a line break.");
  if (!/[$#"`\\]|^\s|\s$|^'/.test(value)) return value;
  if (value.includes("'")) throw new Error("A value with ' and other special characters can't be quoted.");
  return `'${value}'`;
}
