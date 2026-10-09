export interface SecretMatch {
  readonly pattern: string;
  readonly match: string;
  readonly index: number;
  readonly entropy?: number;
}

const SECRET_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "google_api_key", pattern: /AIza[0-9A-Za-z_-]{35}/g },
  { name: "github_token", pattern: /ghp_[A-Za-z0-9]{36}/g },
  { name: "aws_access_key", pattern: /AKIA[0-9A-Z]{16}/g },
  { name: "jwt_token", pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+/g },
  { name: "private_key", pattern: /-----BEGIN (?:RSA|EC|DSA) PRIVATE KEY-----/g },
];
const HIGH_ENTROPY_CANDIDATES = /[A-Za-z0-9+/_=-]{20,}/g;
const MINIMUM_SECRET_LENGTH = 20;
const HIGH_ENTROPY_THRESHOLD = 4.5;

export function shannonEntropy(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  const frequencies = new Map<string, number>();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

export class SecretScanner {
  public static scan(text: string): SecretMatch[] {
    const matches: SecretMatch[] = [];
    for (const entry of SECRET_PATTERNS) {
      entry.pattern.lastIndex = 0;
      let result: RegExpExecArray | null = entry.pattern.exec(text);
      while (result !== null) {
        matches.push({ pattern: entry.name, match: result[0], index: result.index });
        result = entry.pattern.exec(text);
      }
    }

    HIGH_ENTROPY_CANDIDATES.lastIndex = 0;
    let candidate: RegExpExecArray | null = HIGH_ENTROPY_CANDIDATES.exec(text);
    while (candidate !== null) {
      const value = candidate[0];
      const entropy = shannonEntropy(value);
      const overlapsKnownSecret = matches.some((known): boolean =>
        candidate !== null && candidate.index < known.index + known.match.length && known.index < candidate.index + value.length,
      );
      if (value.length >= MINIMUM_SECRET_LENGTH && entropy > HIGH_ENTROPY_THRESHOLD && !overlapsKnownSecret) {
        matches.push({ pattern: "generic_secret", match: value, index: candidate.index, entropy });
      }
      candidate = HIGH_ENTROPY_CANDIDATES.exec(text);
    }
    return matches.sort((left: SecretMatch, right: SecretMatch): number => left.index - right.index);
  }

  public static containsSecrets(text: string): boolean {
    return SecretScanner.scan(text).length > 0;
  }

  public static redact(text: string): string {
    const matches = SecretScanner.scan(text).sort((left: SecretMatch, right: SecretMatch): number => right.index - left.index);
    let redacted = text;
    for (const match of matches) {
      redacted = `${redacted.slice(0, match.index)}[REDACTED]${redacted.slice(match.index + match.match.length)}`;
    }
    return redacted;
  }
}
