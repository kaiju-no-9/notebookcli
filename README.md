# Oden

![Oden terminal wordmark](assets/oden-terminal-logo.png)

Oden is an autonomous terminal agent harness that uses OpenRouter by default and can also use Google Gemini. It is designed to research tasks, modify codebases, run commands inside a Docker sandbox, enforce safety guardrails, and retain user preferences.

## Requirements

- Bun 1.1 or later (primary runtime), or Node.js 18 or later for compatible tooling.
- Docker with Docker Compose and Buildx for building and running the command sandbox.
- An OpenRouter API key and/or a Google Gemini API key. Gemini keys may use the classic `AIza…` format or the newer `AQ.…` authorization-key format. Set `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY` in the environment or enter the selected provider's key when prompted.

## Setup

```sh
bun install
bun run typecheck
bun test
```

For local credentials, copy `.env.example` to `.env` if needed, then set one or both API keys. Bun loads `.env` automatically; `.env` is ignored by Git. Keep keys private.

## Manual test

1. Install dependencies with `bun install`.
2. In `.env`, set `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY` to the keys you want to test.
3. Start Oden with `bun run start`. In an interactive terminal, a brief Oden wordmark appears while the workspace session and provider settings load, then clears to the ready screen.
4. At the prompt, ask a simple question such as `What is 2 + 2?`. Oden shows a working status and prints response text as it arrives from the selected provider. Coding tasks also stream text while retaining tool calls and the usual approval checks.
5. Type `quit` to exit.

OpenRouter is the default. To test Gemini, run `bun run start -- --provider gemini`; to use OpenRouter, run `bun run start -- --provider openrouter`. You can also set `ODEN_PROVIDER=gemini` or `ODEN_PROVIDER=openrouter` in `.env`. Use `--model <model-name>` to override the selected provider's primary model.

On an interactive terminal, Oden asks you to choose a project workspace at startup. The picker offers the current folder, up to five recent project folders, a system folder dialog, entering a path manually, or cancelling startup. macOS uses the system folder chooser; Windows uses the .NET Windows Forms folder browser; Linux tries Zenity and then KDialog. If the platform dialog is unavailable, Oden falls back to manual path entry. Recent paths are stored with Oden's local credential settings. Set `ODEN_WORKSPACE=/absolute/path` in `.env`, or run `bun run start -- --workspace /absolute/path`, to skip the picker. In non-interactive runs, Oden uses the current directory unless one of those workspace overrides is set. The resolved workspace is shown by `/status` and is shared by host file/Git tools, project sessions, and the Docker shell. File reads cannot escape that root through `..` or symlinks, and credential-like files such as `.env` are not readable by file tools.

To manually check code tools, start Oden in a disposable Git project, then ask it to create a small file and verify the file yourself. The command tool uses the Docker sandbox, so build it once with `docker compose build sandbox` and make sure Docker is running. Review any requested actions before allowing commands that modify files.

Oden asks for explicit terminal approval before confirmation-class shell/Git operations, package installs, overwriting existing files, or writing sensitive files. The prompt shows a concise action summary, target, workspace, risk, and reason; select the review option to inspect the proposed file diff or exact action before approving. Rejecting, cancelling, timing out, interrupting, or running without an interactive terminal denies the operation. Hard-blocked commands (including force push and hard reset) cannot be approved. The REPL input is paused while an approval prompt is active.

OpenRouter defaults to `openrouter/free`, which routes requests to currently available free models and filters for request features such as tool calling and structured outputs. Gemini defaults to `gemini-3.8-flash` with `gemini-3.5-flash-lite` for guard checks. Model environment settings are `OPENROUTER_MODEL`, `OPENROUTER_GUARD_MODEL`, `GEMINI_MODEL`, and `GEMINI_GUARD_MODEL`. Type `exit` or `quit` to close the REPL.

## Interactive configuration

Oden shows the active provider and model in the REPL prompt. Use these slash commands to change provider settings or configure optional services:

| Command | Purpose |
|---|---|
| `/provider` | Choose Gemini or OpenRouter, reuse an existing key or enter one if missing, and select a supported model. Oden saves the settings and restarts the application pipeline. |
| `/web` | Save a Tavily API key for higher quality web search. Leave it blank to keep using fallback search. |
| `/memory` | Connect Supermemory by entering its API key in a hidden prompt. |
| `/delete` | Choose and delete a saved Gemini, OpenRouter, Supermemory, or Tavily API key. |
| `/sessions` | Create, switch, or permanently delete project-scoped conversation sessions. |
| `/status` | Show the active provider, model, and configured services. API keys are masked. |
| `/help` | List available commands. |

Provider, model, and service settings are saved through Oden's `ConfigManager` (OS keychain when available, otherwise an encrypted file under `~/.oden`). `/provider` accepts Gemini keys in both `AIza…` and `AQ.…` formats. Existing environment variables and `.env` settings continue to work; command-line `--provider` and `--model` options take precedence at startup. If no provider and API key are configured, Oden starts in setup mode and accepts `/provider`, `/status`, `/help`, and `/sessions` until a provider is set.

Each user turn shares configurable LLM, tool, time, and token budgets across guardrails, routing, research, coding, and streaming. Defaults and `ODEN_MAX_*` overrides are listed in `.env.example`. The regular coding agent makes one model request per iteration with tools enabled; optional planning is off by default. Gemini and OpenRouter stream tool-enabled agent responses, including incremental function-call assembly. Usage is recorded when the provider includes stream usage metadata; otherwise the run budget estimates it. Stream text is displayed before the final output guardrail result is available.

For complex coding requests with at least two independent workstreams, Oden automatically delegates eligible work to up to two read-only specialists. Users do not need to configure this for ordinary use. The existing Supervisor proposes workstreams, and deterministic policy keeps simple tasks on the single-agent path. The configurable `ODEN_MAX_SUBAGENTS` cap defaults to `2` and has a maximum of `3`; set it to `0` to disable delegation or `1` to keep it disabled because a valid plan needs at least two specialists. Specialists share the parent turn's request/token/tool/deadline budget, run at most two at a time, and cannot write files, run commands, use Git, or save session history. The parent verifies their evidence, makes any changes through the regular approval and workspace checks, and returns the only user-facing response.

To check the automatic behavior, start Oden with the default settings. Ask a simple question or one-file edit and confirm it uses the normal path. Then ask for a multi-part change that needs repository inspection and test planning. Watch the concise specialist statuses, confirm the parent checks evidence and uses the ordinary approval prompt for writes, and interrupt with Ctrl+C to stop in-flight provider requests. Set `ODEN_MAX_SUBAGENTS=0` only if you want delegation disabled; a small `ODEN_MAX_LLM_REQUESTS` value can verify delegation is skipped when the parent synthesis reserve cannot be held.

Sessions keep separate conversation histories for each project directory and automatically resume the active session on restart. Run `/sessions` to create, switch, or delete sessions. Deleting a session removes its saved history; deleting the active session switches to the most recently used remaining session, or creates a fresh empty session. Session files are stored under `~/.oden/sessions/` with owner-only permissions. Recognized secrets are redacted, but conversation text is otherwise plaintext on disk. Sessions share the same project files; they do not create separate Git worktrees.

To connect Supermemory, run `/memory` and enter your API key at the hidden prompt. Oden uses `https://api.supermemory.ai/v3`, stores the key through `ConfigManager`, and sends it as a Bearer token. You can also set `MEMORY_API_URL=https://api.supermemory.ai/v3` and `SUPERMEMORY_API_KEY` in `.env`.

## Sandbox

Build the isolated command environment with:

```sh
docker compose build sandbox
```

The sandbox runs as an unprivileged user, drops Linux capabilities, and sets CPU, memory, and process limits in `docker-compose.yaml`.

## Native dependency note

The `keytar` dependency uses native OS keychain integration. On Linux, installing it may require the platform's Secret Service development package (for example, `libsecret-1-dev`). If installation fails while building this dependency, install the matching development headers for your distribution and retry `bun install`.

## Project status

The implementation is being built in the documented phases under `docs/implementation/`. Current verification and blockers are tracked in `docs/progress.md` and `docs/progress/status.md`.
