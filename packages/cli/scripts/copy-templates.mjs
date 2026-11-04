// Copies the monorepo's templates/ into the package, so they ship with it.
import { cpSync, rmSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../../../templates", import.meta.url));
const target = fileURLToPath(new URL("../templates", import.meta.url));

// Local build output, caches and data of a template that was run in place.
const SKIP = new Set([
  "node_modules",
  ".venv",
  "__pycache__",
  ".astro",
  "dist",
  ".pytest_cache",
  ".ruff_cache",
  "media",
  "staticfiles",
  "openapi.json",
  "db.sqlite3",
  ".env",
]);

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true, filter: (path) => !SKIP.has(basename(path)) });
