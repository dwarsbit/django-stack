import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { chooseFreePorts, describeMove, envPorts, freePort, isPortFree, portValues } from "../src/ports";

/** A port check where only the given ports are in use. */
const inUse =
  (...ports: number[]) =>
  async (port: number) =>
    !ports.includes(port);

describe("ports", () => {
  it("keeps the usual ports when they are free", async () => {
    const result = await chooseFreePorts({}, [], inUse());
    expect(result.ports).toEqual({ SITE_PORT: 3000, BACKEND_PORT: 8000, MAIL_PORT: 8025, S3_PORT: 8333 });
    expect(result.moves).toEqual([]);
  });

  it("moves a port in use to the next free one", async () => {
    const result = await chooseFreePorts({}, [], inUse(3000, 3001, 8000));
    expect(result.ports.SITE_PORT).toBe(3002);
    expect(result.ports.BACKEND_PORT).toBe(8001);
    expect(result.moves.map(describeMove)).toEqual([
      "Port 3000 is in use, so the site uses 3002.",
      "Port 8000 is in use, so the backend uses 8001.",
    ]);
  });

  it("checks the local S3 port only with the s3 profile", async () => {
    expect((await chooseFreePorts({}, [], inUse(8333))).moves).toEqual([]);
    expect((await chooseFreePorts({}, ["s3"], inUse(8333))).ports.S3_PORT).toBe(8334);
  });

  it("starts from the ports in .env", async () => {
    const result = await chooseFreePorts({ SITE_PORT: "4000" }, [], inUse());
    expect(result.ports.SITE_PORT).toBe(4000);
  });

  it("gives up after a hundred ports", async () => {
    expect(await freePort(3000, new Set(), async () => false)).toBeUndefined();
    const result = await chooseFreePorts({}, [], async (port) => port !== 8025 && port < 8026);
    expect(result.stuck.map((item) => item.name)).toEqual(["MAIL_PORT"]);
  });

  it("changes the URLs on this machine with the ports", () => {
    const env = {
      SITE_URL: "http://localhost:3000",
      BACKEND_URL: "http://localhost:3000",
      S3_PUBLIC_URL: "http://localhost:8333/media",
      SITE_PORT: "3000",
    };
    expect(portValues(env, { ...envPorts(env), SITE_PORT: 3001, S3_PORT: 8334 })).toEqual({
      SITE_PORT: "3001",
      S3_PORT: "8334",
      SITE_URL: "http://localhost:3001",
      BACKEND_URL: "http://localhost:3001",
      S3_PUBLIC_URL: "http://localhost:8334/media",
    });
    expect(
      portValues({ ...env, SITE_URL: "https://example.com" }, { ...envPorts(env), SITE_PORT: 3001 }),
    ).not.toHaveProperty("SITE_URL");
  });

  it("sees a port in use", async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen({ host: "127.0.0.1", port: 0 }, resolve));
    const { port } = server.address() as { port: number };
    expect(await isPortFree(port)).toBe(false);
    await new Promise((resolve) => server.close(resolve));
    expect(await isPortFree(port)).toBe(true);
  });
});
