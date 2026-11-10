import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Lists the files under a bind-mounted directory, as paths relative to it
 * with forward slashes, or undefined when the path is not a directory.
 */
export function listDirectoryFiles(path: string): string[] | undefined {
  try {
    if (!statSync(path).isDirectory()) return undefined;
  } catch {
    return undefined;
  }
  const files: string[] = [];
  const walk = (relative: string) => {
    for (const entry of readdirSync(join(path, relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) files.push(child);
    }
  };
  walk("");
  return files.sort();
}
