import { lstat, realpath } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";

const SENSITIVE_BASENAMES = new Set([
  ".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519", "id_ecdsa", "credentials", "secrets.json",
]);

export class WorkspaceContext {
  public readonly root: string;

  public constructor(root: string = process.env.ODEN_WORKSPACE ?? process.cwd()) {
    this.root = realpathSync(path.resolve(root));
  }

  public async resolve(inputPath: string, access: "read" | "write" | "directory" = "read"): Promise<string> {
    if (inputPath.includes("\0")) throw new Error("Workspace paths cannot contain a NUL byte");
    const candidate = path.resolve(this.root, inputPath);
    this.assertNotSensitive(candidate, access);

    if (access === "write") {
      await this.assertWriteTarget(candidate);
      return candidate;
    }

    const canonical = await realpath(candidate);
    this.assertWithinRoot(canonical);
    this.assertNotSensitive(canonical, access);
    if (access === "directory" && !(await lstat(canonical)).isDirectory()) {
      throw new Error(`Workspace path is not a directory: ${inputPath}`);
    }
    return canonical;
  }

  public isSensitive(inputPath: string): boolean {
    return this.isSensitiveName(path.basename(inputPath));
  }

  private async assertWriteTarget(candidate: string): Promise<void> {
    let ancestor = candidate;
    while (true) {
      try {
        const canonicalAncestor = await realpath(ancestor);
        this.assertWithinRoot(canonicalAncestor);
        this.assertNotSensitive(candidate, "write");
        try {
          const canonicalTarget = await realpath(candidate);
          this.assertWithinRoot(canonicalTarget);
        } catch (error: unknown) {
          if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        }
        return;
      } catch (error: unknown) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
        const parent = path.dirname(ancestor);
        if (parent === ancestor) throw new Error("No existing directory found inside the workspace");
        ancestor = parent;
      }
    }
  }

  private assertWithinRoot(candidate: string): void {
    const relative = path.relative(this.root, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error(`Path escapes the selected workspace: ${candidate}`);
    }
  }

  private assertNotSensitive(candidate: string, access: "read" | "write" | "directory"): void {
    if (access === "read" && this.isSensitiveName(path.basename(candidate))) {
      throw new Error(`Reading sensitive files is blocked: ${path.basename(candidate)}`);
    }
  }

  private isSensitiveName(name: string): boolean {
    return name === ".env" || name.startsWith(".env.") || SENSITIVE_BASENAMES.has(name.toLowerCase());
  }
}
