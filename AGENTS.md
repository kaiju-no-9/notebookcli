# AGENTS.md — Oden Project

## Project Overview

Oden is an autonomous terminal agent harness — an AI coding assistant that runs in the terminal, uses Google Gemini LLM, conducts web research, modifies codebases, executes commands in a Docker sandbox, enforces safety guardrails, and retains user preferences.

## Coding-Agent Workflow

### Progressive Documentation Loading Protocol

When implementing any phase, follow this exact sequence:

1. **Always read this file first** (`AGENTS.md`).
2. **Read** [`docs/README.md`](docs/README.md) — the documentation index.
3. **Read the current phase specification** (e.g., `docs/implementation/phase-01.md`).
4. **Read only the documents referenced by that phase** — architecture, contracts, and module specs listed in the phase's "Related Documents" section.
5. **Inspect the relevant source code and tests** already in the repository.
6. **Implement the phase**, run verification commands listed in the phase spec.
7. **Update** [`docs/progress/status.md`](docs/progress/status.md) only after verifying results.

> **Do NOT load the entire `docs/` directory for every task.** Each phase spec tells you exactly which documents you need.

### Handling Edge Cases

| Situation | Action |
|---|---|
| Missing specification | Stop. Report which spec is missing and what decision is blocked. |
| Conflicting contracts | Stop. Report the conflicting documents with file paths and line numbers. |
| Failing tests | Report the failure with full output. Do not modify tests to make them pass unless the phase spec explicitly says to. |
| Unexpected repository changes | Report what changed and which phase specs may be affected. |
| Ambiguous requirement | Implement the most conservative interpretation and document the assumption in a code comment. |

**Never silently invent architectural decisions.** If a decision isn't documented, report it.

## Engineering Conventions

### Language & Runtime

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun (>=1.1) / Node.js (>=18)
- **Module system:** ESNext with bundler module resolution
- **Schema validation:** Zod v4

### File Organization

```
src/
├── agent/          # Agent core — ReAct loop, research agent, message types
├── cli/            # CLI layer — REPL, terminal UI, state management
├── config/         # Configuration — credential management, env vars
├── guardrails/     # Safety — input/output guardrails, secret scanning
│   ├── input/
│   ├── output/
│   └── types/
├── logger/         # Structured logging with secret redaction
├── orchestration/  # Orchestrator, supervisor, routing
├── providers/      # LLM provider abstraction, Gemini implementation
├── tools/          # Tool registry, all tool implementations
├── utils/          # Error translator, shared utilities
└── index.ts        # Entry point
```

### Naming Conventions

- **Files:** PascalCase for classes/modules (e.g., `AgentCLI.ts`), camelCase for utilities (e.g., `executeTools.ts`)
- **Classes:** PascalCase (e.g., `Orchestrator`, `SecretScanner`)
- **Interfaces:** PascalCase, descriptive names (e.g., `LLMProvider`, `ToolDefinition`, `GuardrailResult`)
- **Functions:** camelCase (e.g., `classifyIntent`, `scanForSecrets`)
- **Constants:** UPPER_SNAKE_CASE (e.g., `MAX_AGENT_STEPS`, `DEFAULT_MODEL`)
- **Types/Enums:** PascalCase (e.g., `AgentMode`, `RouteDecision`)

### Code Style Rules

1. All functions must have explicit return types.
2. Use `interface` for public contracts, `type` for unions/intersections.
3. Prefer `readonly` properties in interfaces.
4. Use Zod schemas for all external data validation (LLM responses, API inputs).
5. No `any` — use `unknown` and narrow.
6. Errors must be caught and translated via `ErrorTranslator`.
7. All async functions must handle rejection.
8. Secrets must never appear in logs — use `AgentLogger` with redaction.

### Dependency Rules

- Dependencies flow **downward**: `cli → orchestration → agent → tools → providers → config`
- **No circular dependencies.**
- Lower layers must not import from higher layers.
- `utils/` and `logger/` may be imported by any layer.
- `config/` may be imported by any layer.
- `providers/` must not import from `agent/`, `tools/`, `orchestration/`, or `cli/`.
- `tools/` must not import from `agent/`, `orchestration/`, or `cli/`.

### Testing Conventions

- Test files live alongside source files: `Agent.test.ts` next to `Agent.ts`.
- Use Bun's built-in test runner (`bun test`).
- Unit tests for all pure logic.
- Integration tests for tool execution and LLM provider calls (with mocks).
- Name tests descriptively: `"should classify CODE_ONLY intent for coding requests"`.

### Git Conventions

- Commit messages: `type(scope): description` (e.g., `feat(tools): add SearchTool with 4-tier cascade`)
- One commit per completed phase.
- Branch per phase: `phase-XX/description`.

## Quick Reference

| Document | Purpose |
|---|---|
| [`docs/README.md`](docs/README.md) | Documentation index and navigation |
| [`docs/requirements/`](docs/requirements/) | What the system must accomplish |
| [`docs/architecture/`](docs/architecture/) | How the system is structured |
| [`docs/modules/`](docs/modules/) | Individual component specifications |
| [`docs/implementation/`](docs/implementation/) | What to build and verify, phase by phase |
| [`docs/testing/`](docs/testing/) | How correctness is demonstrated |
| [`docs/progress/`](docs/progress/) | What has been implemented and verified |
