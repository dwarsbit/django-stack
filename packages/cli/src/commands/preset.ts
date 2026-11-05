import * as p from "@clack/prompts";
import pc from "picocolors";
import { selfCommand } from "../global-install";
import { applies, encodePreset, NAMED_PRESETS, resolvePreset, STACK_OPTIONS, type StackKey } from "../stack";
import { command, fail, intro, isInteractive } from "../ui";
import { chooseStack } from "./init";

export interface PresetOptions {
  yes?: boolean;
  [key: string]: unknown;
  fromCli: (option: string) => boolean;
}

/** Without a code: ask for the stack options and print the code. With one: print its stack. */
export async function preset(code: string | undefined, options: PresetOptions) {
  intro(code ? "Preset" : "Create a preset");
  if (code) {
    let stack: ReturnType<typeof resolvePreset>;
    try {
      stack = resolvePreset(code);
    } catch (error) {
      fail((error as Error).message);
    }
    const lines = STACK_OPTIONS.filter((option) => applies(option.key as StackKey, stack)).map((option) => {
      const value = option.values.find((candidate) => candidate.value === stack[option.key as StackKey]);
      return `${pc.bold(option.message.padEnd(24))}${value?.label ?? ""}`;
    });
    p.note(lines.join("\n"), command(`--preset ${encodePreset(stack)}`));
    p.outro(
      `Use it with ${command(`${selfCommand()} init --preset ${code in NAMED_PRESETS ? code : encodePreset(stack)}`)}`,
    );
    return;
  }
  const { stack } = await chooseStack(options, isInteractive(options.yes));
  const encoded = encodePreset(stack);
  p.outro(`Create this stack with ${command(`${selfCommand()} init --preset ${encoded}`)}`);
}
