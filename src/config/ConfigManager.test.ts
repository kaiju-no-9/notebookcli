import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigManager } from "./ConfigManager.js";

describe("ConfigManager", (): void => {
  let temporaryHome: string;
  let originalHome: string | undefined;
  let originalEnvironmentValue: string | undefined;
  let originalDisableKeytar: string | undefined;

  beforeEach(async (): Promise<void> => {
    temporaryHome = await mkdtemp(join(tmpdir(), "oden-config-test-"));
    originalHome = process.env.HOME;
    originalEnvironmentValue = process.env.ODEN_TEST_SECRET;
    originalDisableKeytar = process.env.ODEN_DISABLE_KEYTAR;
    process.env.HOME = temporaryHome;
    process.env.ODEN_DISABLE_KEYTAR = "1";
    delete process.env.ODEN_TEST_SECRET;
  });

  afterEach(async (): Promise<void> => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalEnvironmentValue === undefined) {
      delete process.env.ODEN_TEST_SECRET;
    } else {
      process.env.ODEN_TEST_SECRET = originalEnvironmentValue;
    }
    if (originalDisableKeytar === undefined) {
      delete process.env.ODEN_DISABLE_KEYTAR;
    } else {
      process.env.ODEN_DISABLE_KEYTAR = originalDisableKeytar;
    }
    await rm(temporaryHome, { recursive: true, force: true });
  });

  it("returns an environment variable before stored values", async (): Promise<void> => {
    process.env.ODEN_TEST_SECRET = "environment-secret";
    await ConfigManager.set("ODEN_TEST_SECRET", "stored-secret");
    expect(await ConfigManager.get("ODEN_TEST_SECRET")).toBe("environment-secret");
  });

  it("round-trips through the encrypted file when keytar is unavailable", async (): Promise<void> => {
    await ConfigManager.set("ODEN_TEST_SECRET", "file-secret");
    expect(await ConfigManager.get("ODEN_TEST_SECRET")).toBe("file-secret");
    expect(await ConfigManager.has("ODEN_TEST_SECRET")).toBe(true);

    const path = join(temporaryHome, ".oden", "credentials.enc");
    const fileContents = await readFile(path);
    expect(fileContents.length).toBeGreaterThan(32);
    expect(fileContents.includes(Buffer.from("file-secret"))).toBe(false);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("uses AES-256-GCM with a 16-byte IV and authentication tag", async (): Promise<void> => {
    await ConfigManager.set("ODEN_TEST_SECRET", "ciphertext-check");
    const fileContents = await readFile(join(temporaryHome, ".oden", "credentials.enc"));
    expect(fileContents.subarray(0, 16)).toHaveLength(16);
    expect(fileContents.subarray(16, 32)).toHaveLength(16);
    expect(await ConfigManager.get("ODEN_TEST_SECRET")).toBe("ciphertext-check");
  });

  it("removes a corrupted encrypted file and reports missing values", async (): Promise<void> => {
    const directory = join(temporaryHome, ".oden");
    const path = join(directory, "credentials.enc");
    await mkdir(directory, { recursive: true });
    await writeFile(path, Buffer.from("invalid"));
    expect(await ConfigManager.has("ODEN_TEST_SECRET")).toBe(false);
    await expect(readFile(path)).rejects.toThrow();
  });

  it("does not prompt for a missing key in non-interactive sessions", async (): Promise<void> => {
    expect(await ConfigManager.has("ODEN_TEST_MISSING")).toBe(false);
    await expect(ConfigManager.get("ODEN_TEST_MISSING")).rejects.toThrow("non-interactive session");
  });
});
