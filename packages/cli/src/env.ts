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
