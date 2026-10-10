# Oden

Oden is an autonomous terminal agent harness powered by Google Gemini. It is designed to research tasks, modify codebases, run commands inside a Docker sandbox, enforce safety guardrails, and retain user preferences.

## Requirements

- Bun 1.1 or later (primary runtime), or Node.js 18 or later for compatible tooling.
- Docker with Docker Compose and Buildx for building and running the command sandbox.
- A Google Gemini API key. Set `GEMINI_API_KEY` in the environment or enter it when prompted on the first launch.

## Setup

```sh
bun install
bun run typecheck
bun test
```

Start the interactive agent with:

```sh
bun run start
```

Choose a different Gemini model with `bun run start -- --model <model-name>`. Type `exit` or `quit` to close the REPL.

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
