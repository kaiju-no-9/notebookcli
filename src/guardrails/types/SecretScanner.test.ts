import { describe, expect, it } from "bun:test";
import { SecretScanner, shannonEntropy } from "./SecretScanner.js";

describe("SecretScanner", (): void => {
  it("detects Google, GitHub, AWS, JWT, and private-key header patterns", (): void => {
    const values = [
      "AIza12345678901234567890123456789012345",
      "ghp_abcdefghijklmnopqrstuvwxyz1234567890",
      "AKIAIOSFODNN7EXAMPLE",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
      "-----BEGIN RSA PRIVATE KEY-----",
    ];
    for (const value of values) {
      expect(SecretScanner.containsSecrets(value)).toBe(true);
    }
  });

  it("detects base64/alphanumeric high-entropy tokens above 4.5 bits", (): void => {
    const token = "K9mP2xQ7vN4bR8cT1zW5dF0hJ3sL6aY0";
    expect(shannonEntropy(token)).toBeGreaterThan(4.5);
    expect(SecretScanner.scan(token)).toEqual([
      { pattern: "generic_secret", match: token, index: 0, entropy: shannonEntropy(token) },
    ]);
  });

  it("keeps Shannon entropy mathematically accurate for hexadecimal strings", (): void => {
    const hex = "0123456789abcdef0123456789abcdef";
    expect(shannonEntropy(hex)).toBe(4);
    expect(SecretScanner.containsSecrets(hex)).toBe(false);
  });

  it("does not flag ordinary English text", (): void => {
    expect(SecretScanner.scan("This is a normal sentence with no secret in it.")).toEqual([]);
  });

  it("reports entropy below the threshold for repeated characters", (): void => {
    expect(shannonEntropy("aaaaaa")).toBeLessThan(4.5);
  });

  it("redacts all detected secret matches", (): void => {
    const input = "key=AIza12345678901234567890123456789012345 and ghp_abcdefghijklmnopqrstuvwxyz1234567890";
    expect(SecretScanner.redact(input)).toBe("key=[REDACTED] and [REDACTED]");
  });
});
