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
  it("writes six characters for every stack", () => {
    for (const stack of allStacks()) expect(encodePreset(stack)).toMatch(/^b[0-9a-zA-Z]{5}$/);
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

  it("fits every option in the code", () => {
    const bits = STACK_OPTIONS.reduce((sum, option) => sum + option.bits, 0);
    expect(bits).toBeLessThanOrEqual(29);
    for (const option of STACK_OPTIONS) expect(option.values.length).toBeLessThanOrEqual(2 ** option.bits);
  });

  it("keeps its codes", () => {
    // These codes are public: changing them breaks shared presets.
    expect(encodePreset(DEFAULT_STACK)).toBe("bD8rUX");
    expect(encodePreset({ ...DEFAULT_STACK, frontend: "next" })).toBe("b3m1Gw");
    expect(decodePreset("bxAwyd")).toMatchObject({ frontend: "headless", analytics: "off" });
  });

  it("reads the codes of the first format", () => {
    expect(decodePreset("a")).toEqual(DEFAULT_STACK);
    expect(decodePreset("a1")).toEqual({ ...DEFAULT_STACK, frontend: "next" });
    expect(decodePreset("a000010002")).toMatchObject({ cache: "valkey", packageManager: "bun" });
    expect(decodePreset("a2010")).toMatchObject({ frontend: "headless", analytics: "off" });
    expect(decodePreset("a5")).toMatchObject({ frontend: "sveltekit" });
  });

  it("asks for a newer CLI for codes it cannot read", () => {
    expect(() => decodePreset("c")).toThrow(/newer CLI/);
    expect(() => decodePreset("a9")).toThrow(/newer CLI/);
    expect(() => decodePreset(`a${"0".repeat(STACK_OPTIONS.length + 1)}`)).toThrow(/newer CLI/);
  });

  it("refuses most typos", () => {
    const code = encodePreset({ ...DEFAULT_STACK, frontend: "next" });
    let refused = 0;
    let typos = 0;
    for (let position = 1; position < code.length; position++) {
      for (const digit of "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ") {
        if (digit === code[position]) continue;
        typos++;
        try {
          decodePreset(code.slice(0, position) + digit + code.slice(position + 1));
        } catch {
          refused++;
        }
      }
    }
    expect(refused / typos).toBeGreaterThan(0.9);
  });

  it("asks for uploads in production before uploads in development", () => {
    expect(PROMPT_ORDER).toHaveLength(STACK_OPTIONS.length);
    expect(PROMPT_ORDER.indexOf("media")).toBe(PROMPT_ORDER.indexOf("storage") - 1);
    expect(decodePreset("a").media).toBe("server");
  });

  it("rejects what is not a code", () => {
    expect(() => decodePreset("a-1")).toThrow(/is not a preset/);
    expect(() => decodePreset("1")).toThrow(/is not a preset/);
    expect(() => decodePreset("b")).toThrow(/is not a preset/);
    expect(() => decodePreset("bD8rUXa")).toThrow(/is not a preset/);
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
    const stack = { ...DEFAULT_STACK, tasks: "huey-valkey" as const };
    expect(decodePreset(encodePreset(stack))).toEqual(stack);
    expect(decodePreset("a0002").tasks).toBe("huey-valkey");
  });
});
