# Oden

Oden is an autonomous terminal agent harness that uses OpenRouter by default and can also use Google Gemini. It is designed to research tasks, modify codebases, run commands inside a Docker sandbox, enforce safety guardrails, and retain user preferences.

## Requirements

- Bun 1.1 or later (primary runtime), or Node.js 18 or later for compatible tooling.
- Docker with Docker Compose and Buildx for building and running the command sandbox.
- An OpenRouter API key and/or a Google Gemini API key. Set `OPENROUTER_API_KEY` and/or `GEMINI_API_KEY` in the environment or enter the selected provider's key when prompted.

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
3. Start Oden with `bun run start`.
4. At the prompt, ask a simple question such as `What is 2 + 2?`. This sends a live request to the selected provider.
5. Type `quit` to exit.

OpenRouter is the default. To test Gemini, run `bun run start -- --provider gemini`; to use OpenRouter, run `bun run start -- --provider openrouter`. You can also set `ODEN_PROVIDER=gemini` or `ODEN_PROVIDER=openrouter` in `.env`. Use `--model <model-name>` to override the selected provider's primary model.

To manually check code tools, start Oden in a disposable Git project, then ask it to create a small file and verify the file yourself. The command tool uses the Docker sandbox, so build it once with `docker compose build sandbox` and make sure Docker is running. Review any requested actions before allowing commands that modify files.

OpenRouter defaults to `openrouter/free`, which routes requests to currently available free models and filters for request features such as tool calling and structured outputs. Gemini defaults to `gemini-3.8-flash` with `gemini-3.5-flash-lite` for guard checks. Model environment settings are `OPENROUTER_MODEL`, `OPENROUTER_GUARD_MODEL`, `GEMINI_MODEL`, and `GEMINI_GUARD_MODEL`. Type `exit` or `quit` to close the REPL.

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
