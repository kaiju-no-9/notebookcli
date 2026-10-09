import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { hostname, userInfo } from "node:os";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const SERVICE_NAME = "oden";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

type CredentialMap = Record<string, string>;

async function keytarModule(): Promise<typeof import("keytar") | undefined> {
  if (process.env.ODEN_DISABLE_KEYTAR === "1") {
    return undefined;
  }
  try {
    return await import("keytar");
  } catch {
    return undefined;
  }
}

function credentialsPath(): string {
  return `${process.env.HOME ?? homedir()}/.oden/credentials.enc`;
}

function encryptionKey(): Buffer {
  const identity = `${hostname()}\0${userInfo().username}`;
  return createHash("sha256").update(identity).digest();
}

function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function decrypt(payload: Buffer): string {
  if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error("Encrypted credentials file is incomplete");
  }
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

async function readCredentials(): Promise<CredentialMap> {
  try {
    const contents = decrypt(await readFile(credentialsPath()));
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const entries = Object.entries(parsed);
      if (entries.every((entry: [string, unknown]) => typeof entry[1] === "string")) {
        return Object.fromEntries(entries) as CredentialMap;
      }
    }
    throw new Error("Encrypted credentials have an invalid structure");
  } catch (error: unknown) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return {};
    }
    // A damaged or machine-mismatched credential store is removed before prompting again.
    await rm(credentialsPath(), { force: true }).catch((): void => undefined);
    return {};
  }
}

async function writeCredentials(credentials: CredentialMap): Promise<void> {
  const path = credentialsPath();
  await mkdir(`${process.env.HOME ?? homedir()}/.oden`, { recursive: true, mode: 0o700 });
  await writeFile(path, encrypt(JSON.stringify(credentials)), { mode: 0o600 });
  await chmod(path, 0o600);
}

async function promptForValue(key: string): Promise<string> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error(`Configuration value ${key} is missing and cannot be prompted for in a non-interactive session`);
  }
  const readline = createInterface({ input: stdin, output: stdout });
  try {
    const value = await readline.question(`Enter ${key}: `);
    if (value.length === 0) {
      throw new Error(`No value provided for ${key}`);
    }
    await ConfigManager.set(key, value);
    return value;
  } finally {
    readline.close();
  }
}

export class ConfigManager {
  public static async get(key: string): Promise<string> {
    const environmentValue = process.env[key];
    if (environmentValue !== undefined && environmentValue.length > 0) {
      return environmentValue;
    }

    const keytar = await keytarModule();
    if (keytar !== undefined) {
      try {
        const value = await keytar.getPassword(SERVICE_NAME, key);
        if (value !== null && value.length > 0) {
          return value;
        }
      } catch {
        // Keychain access is optional; continue to the encrypted file.
      }
    }

    const stored = await readCredentials();
    const fileValue = stored[key];
    if (fileValue !== undefined) {
      return fileValue;
    }
    return promptForValue(key);
  }

  public static async set(key: string, value: string): Promise<void> {
    const keytar = await keytarModule();
    if (keytar !== undefined) {
      try {
        await keytar.setPassword(SERVICE_NAME, key, value);
        return;
      } catch {
        // Keychain access is optional; continue to the encrypted file.
      }
    }

    const credentials = await readCredentials();
    credentials[key] = value;
    await writeCredentials(credentials);
  }

  public static async has(key: string): Promise<boolean> {
    const environmentValue = process.env[key];
    if (environmentValue !== undefined && environmentValue.length > 0) {
      return true;
    }
    const keytar = await keytarModule();
    if (keytar !== undefined) {
      try {
        const value = await keytar.getPassword(SERVICE_NAME, key);
        if (value !== null && value.length > 0) {
          return true;
        }
      } catch {
        // Keychain access is optional; continue to the encrypted file.
      }
    }
    return (await readCredentials())[key] !== undefined;
  }
}
