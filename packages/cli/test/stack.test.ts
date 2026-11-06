import { describe, expect, it } from "vitest";
import {
  applies,
  DEFAULT_STACK,
  decodePreset,
  encodePreset,
  NAMED_PRESETS,
  PROMPT_ORDER,
  pendingChoices,
  resolvePreset,
  STACK_OPTIONS,
  type Stack,
  taskQueue,
} from "../src/stack";

/** Every combination of every option's values. */
function allStacks(): Stack[] {
  let stacks: Record<string, string>[] = [{}];
  for (const option of STACK_OPTIONS) {
    stacks = stacks.flatMap((stack) =>
      option.values.map((value) => ({ ...stack, [option.key]: value.value })),
    );
  }
  return stacks as Stack[];
}

describe("presets", () => {
  it("encodes the defaults as the version alone", () => {
    expect(encodePreset(DEFAULT_STACK)).toBe("a");
    expect(decodePreset("a")).toEqual(DEFAULT_STACK);
  });

  it("round-trips every combination", () => {
    const codes = new Set<string>();
    for (const stack of allStacks()) {
      const code = encodePreset(stack);
      expect(decodePreset(code)).toEqual(stack);
      codes.add(code);
    }
    expect(codes.size).toBe(allStacks().length);
  });

  it("keeps the codes of the first version", () => {
    // These codes are public: changing them breaks shared presets.
    expect(encodePreset({ ...DEFAULT_STACK, frontend: "next" })).toBe("a1");
    expect(encodePreset({ ...DEFAULT_STACK, cache: "valkey", packageManager: "bun" })).toBe("a000010002");
    expect(decodePreset("a2010")).toMatchObject({ frontend: "headless", analytics: "off" });
    expect(encodePreset({ ...DEFAULT_STACK, frontend: "nuxt" })).toBe("a4");
    expect(encodePreset({ ...DEFAULT_STACK, frontend: "sveltekit" })).toBe("a5");
  });

  it("reads missing characters as defaults", () => {
    expect(decodePreset("a1")).toEqual({ ...DEFAULT_STACK, frontend: "next" });
  });

  it("asks for a newer CLI for codes it cannot read", () => {
    expect(() => decodePreset("b")).toThrow(/newer CLI/);
    expect(() => decodePreset("a9")).toThrow(/newer CLI/);
    expect(() => decodePreset(`a${"0".repeat(STACK_OPTIONS.length + 1)}`)).toThrow(/newer CLI/);
  });

  it("rejects what is not a code", () => {
    expect(() => decodePreset("a-1")).toThrow(/is not a preset/);
    expect(() => decodePreset("1")).toThrow(/is not a preset/);
  });

  it("resolves the named presets", () => {
    expect(resolvePreset("blog")).toEqual(DEFAULT_STACK);
    expect(resolvePreset("api")).toMatchObject({ frontend: "headless", analytics: "off" });
    for (const name of Object.keys(NAMED_PRESETS))
      expect(() => encodePreset(resolvePreset(name))).not.toThrow();
  });
});

describe("pendingChoices", () => {
  it("lists what is not generated yet, and which of it are defaults", () => {
    const pending = pendingChoices({ ...DEFAULT_STACK, frontend: "headless" });
    expect(pending).toContainEqual({ key: "frontend", choice: "--frontend headless", isDefault: false });
    expect(pending).toContainEqual({
      key: "notifications",
      choice: "--notifications on",
      isDefault: true,
    });
    expect(pending.map((item) => item.key)).not.toContain("cache");
  });

  it("skips the package manager without a Node frontend", () => {
    const pending = pendingChoices({ ...DEFAULT_STACK, frontend: "headless" });
    expect(pending.map((item) => item.key)).not.toContain("packageManager");
  });

  it("asks for the package manager with every Node frontend", () => {
    for (const frontend of ["astro", "next", "nuxt", "sveltekit"] as const)
      expect(applies("packageManager", { frontend })).toBe(true);
  });
});

describe("tasks and cache", () => {
  it("asks for the cache before the tasks, keeping every option", () => {
    expect(PROMPT_ORDER.indexOf("cache")).toBe(PROMPT_ORDER.indexOf("tasks") - 1);
    expect([...PROMPT_ORDER].sort()).toEqual(STACK_OPTIONS.map((option) => option.key).sort());
  });

  it("keeps the task queue where the cache is, unless Valkey is asked for", () => {
    expect(taskQueue({ cache: "database", tasks: "huey" })).toBe("database");
    expect(taskQueue({ cache: "off", tasks: "huey" })).toBe("database");
    expect(taskQueue({ cache: "valkey", tasks: "huey" })).toBe("valkey");
    expect(taskQueue({ cache: "database", tasks: "huey-valkey" })).toBe("valkey");
    expect(taskQueue({ cache: "valkey", tasks: "off" })).toBe("none");
  });

  it("appends Huey on Valkey to the tasks", () => {
    expect(encodePreset({ ...DEFAULT_STACK, tasks: "huey-valkey" })).toBe("a0002");
  });
});
