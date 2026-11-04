#!/usr/bin/env node
import pc from "picocolors";
import { createProgram } from "./program";

const program = createProgram();
if (process.argv.length <= 2) {
  program.outputHelp();
} else {
  program.parseAsync().catch((error) => {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
