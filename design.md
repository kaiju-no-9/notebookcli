# Oden — Coding Agent TUI Design System

> A focused terminal interface for directing coding tasks, following agent activity, reviewing proposed changes, and approving sensitive actions.

## 1. Product and UI goals

- **Product:** Oden, a terminal coding-agent harness.
- **Primary user goal:** choose a project, describe a task, understand what Oden is doing, review its result, and stay in control of changes.
- **Mood:** capable, polished, precise, and trustworthy, with the visual clarity of a terminal dashboard.
- **Density:** moderate. Use framed context and metric panels, while keeping the task conversation readable and primary.
- **Primary surface:** terminal TUI/REPL. Do not design this as a system-monitor dashboard or assume a graphical browser UI.
- **Terminal support:** work with TrueColor when available, degrade to 256-color and basic ANSI, and remain readable without color.

### Design principles

1. **Keep the user’s task central.** Conversation and the current task take priority over decorative panels.
2. **Make activity legible.** Clearly distinguish waiting, model response, file inspection, tool execution, approval, and completion.
3. **Keep control visible.** Show the selected project, active session, provider/model, and approval decisions at the moments they matter.
4. **Use progressive detail.** Show concise progress by default; put verbose errors, tool results, and token details behind explicit expansion or diagnostic modes.
5. **Never imply an action happened when it did not.** Mark proposed, running, completed, denied, cancelled, and failed states distinctly.

## 2. Theme and semantic colors

Use the terminal’s existing background when possible. Do not force pure black if the user’s terminal theme supplies a background.

| Role | Hex reference | Usage |
|---|---|---|
| Primary text | `#D8DEE8` | User and assistant messages, important labels |
| Secondary text | `#A4AFBD` | Supporting descriptions and metadata |
| Muted | `#738092` | Timestamps, hints, inactive labels |
| Surface | `#171C24` | Optional grouped content in capable terminals |
| Border | `#394352` | Dividers and low-emphasis boxes |
| Oden accent | `#79CFE0` | Active prompt, selected item, current stage |
| Working | `#91B8F5` | In-progress agent/tool activity |
| Success | `#82C99B` | Completed checks and successful actions |
| Warning | `#E8C77A` | Pending approval, partial results, budget notices |
| Error | `#F07878` | Failed actions, denied operations, blocking errors |
| Specialist | `#B39AE8` | Read-only subagent activity |

Color is always paired with a word or icon, such as `RUNNING`, `APPROVAL REQUIRED`, or `FAILED`. Never rely on color alone. Use restrained, distinct accents for context, research, specialists, and run metrics; use green/yellow/red meter colors to show low, nearing-limit, and high budget usage. Keep red for errors, destructive risk, and metrics near their configured limits.

### ANSI fallback

- TrueColor: use the reference palette above.
- 256-color: map to readable cyan, blue, green, yellow, red, violet, and gray values.
- Basic ANSI: use cyan for Oden/current focus, blue for activity, green for success, yellow for warnings, red for errors, and default foreground for body text.
- No color: use labels, indentation, and symbols to preserve meaning.

## 3. Typography and hierarchy

Use the terminal’s monospace font; do not simulate a logo with large ASCII art.

| Level | Style | Example |
|---|---|---|
| App identity | Bold, Oden accent | `ODEN` |
| Current task | Normal/high contrast | `Create a responsive settings page` |
| Stage/status | Muted label + semantic state | `WORKING · Inspecting project files` |
| Tool/result title | Bold | `Read src/index.ts` |
| File path/command | Monospace (native terminal), secondary text | `src/cli/AgentCLI.ts` |
| Approval/risk | Bold semantic label | `APPROVAL REQUIRED · Modify existing file` |
| Hint | Muted | `Ctrl+C cancels the current run` |

Avoid all-caps paragraphs. Use short headings and concise status phrases.

## 4. Layout

### Main interactive screen

Keep a single-column conversation flow as the default, framed by compact dashboard-style panels. Use Oden's identity, workspace, provider/model, session, live activity, and per-run budget meters as the visual structure. The prompt remains available after the context panel.

```text
╭─ ODEN / CODING AGENT ─────────────────────────────────────────╮
│ PROJECT    ~/work/my-app                                      │
│ MODEL      OpenRouter / free                                  │
│ SESSION    Settings page                                      │
│ READY      Enter 'exit' or 'quit' to leave · /help lists commands │
╰───────────────────────────────────────────────────────────────╯

You
Create a responsive settings page with a dark theme.

╎ ◌ WORKING  Inspecting the project
  [READ] ◌ RUNNING  get_project_tree
  [READ] ✓ DONE     coding_context_tool

ODEN
I found the app entry point and existing page structure…

oden [openrouter/free | Settings page]>
```

This is a design example, not a guarantee that every listed progress event is currently emitted. Render only events received from the harness; do not invent detailed tool activity to make the screen look busy.

### Compact terminal behavior

- At 80 columns or wider, show the project/session context and comfortable indentation.
- At 60–79 columns, wrap content and abbreviate secondary metadata.
- Below 60 columns, use a compact single-column mode: hide nonessential metadata and avoid side-by-side panels.
- Never truncate a command, file path, approval target, or error in a way that changes its meaning. Wrap or provide an explicit detail view.

### Optional detail views

A future richer TUI may add a collapsible activity pane or file-change panel. The current CLI uses stacked panels and inline event rows rather than a full-screen dashboard. A richer view must not displace the conversation, hide an approval request, or be required for completing a task.

## 5. Components

### Workspace picker

- Clearly identify the selected project directory before starting a task.
- Offer recent projects, a native folder dialog where available, manual path entry, and cancel.
- Do not present Oden’s own installation/repository directory as a normal coding target. If Oden development is supported, make that an explicit developer-only choice.
- Show the resolved directory in `/status` and in the session context.

### Session selector

- List title, project, and last-active time.
- Mark the active session with `ACTIVE` and a clear selection indicator.
- Creating, switching, and deleting are distinct actions. Deletion requires confirmation and an easy cancel path.
- Do not expose raw UUIDs unless the user asks for details.

### Prompt and conversation

- Use `oden [provider/model | session]>` as the primary input cue.
- Separate user messages from Oden messages with labels and spacing, not large bordered cards.
- Stream response text as it arrives. Preserve readable line wrapping and avoid redrawing already printed text.
- Keep system activity out of the user’s message content; render it as a separate, muted status line.

### Activity timeline

Use concise, time-ordered events:

```text
WORKING · Starting coding agent
✓ Project inspected
◌ Running tests
✓ Tests passed
```

- Active state: `◌` or `…` plus `WORKING`.
- Completed: `✓ DONE`.
- Failed: `✕ FAILED` plus a short reason.
- Cancelled: `Ⅱ CANCELLED`.
- Approval wait: `! APPROVAL REQUIRED`.
- Subagents: identify them as read-only specialists; show role and state, not their full transcripts.
- Keep status updates event-driven and avoid repetitive spinner/status noise.

### Run header and stage indicator

- Keep a compact context strip for workspace, active session, provider/model, and run state.
- Use a short stage label such as `Planning`, `Searching`, `Editing`, or `Verifying` only when the harness reports that stage. Otherwise use a truthful generic state such as `WORKING`.
- A stage sequence may be shown as a simple checklist, but mark completed stages only after receiving a completion event. Do not imply that every task follows the same fixed sequence.

### Tool and specialist indicators

Use short text tags so tool activity is scannable and still clear without color:

| Tag | Meaning |
|---|---|
| `[READ]` | Read or inspect project files |
| `[WRITE]` | Create or modify files |
| `[SEARCH]` | Search the web or a codebase |
| `[CMD]` | Run a command |
| `[TEST]` | Run a test or validation command |
| `[GIT]` | Inspect or change Git state |
| `[MEMORY]` | Read or write configured memory |

For parallel specialists, show each role, its current state, and whether its result is ready. Keep the parent task visible and identify delegated agents as read-only where that is the actual constraint. Do not display a specialist as running until it has started.

### Change review and verification

- When the harness can report changed files, summarize the count and list paths in a compact review section.
- Show validation commands with `RUNNING`, `PASSED`, or `FAILED`, and include a short failure summary when available.
- Distinguish files inspected from files changed. Do not infer a diff or claim a check ran from the user’s request alone.
- Keep detailed diffs and long command output behind an explicit expand/detail action in a richer TUI; plain REPL output should stay concise.

### Run usage details

Keep usage metrics secondary to the task and conversation. A compact summary may appear at completion; an expanded detail view can show the per-run counters and configured limits when those values are available:

| Metric | Display guidance |
|---|---|
| Elapsed time | Show actual elapsed time; compare with the time limit only when useful |
| Model requests | Separate attempts from successful responses; include the configured cap when known |
| Tool invocations | Show actual calls and the configured cap when known |
| Tokens | Label provider-reported usage as observed and local accounting as estimated; never present an estimate as exact |
| Retries | Show only retries that actually occurred |
| Subagents | Show started/completed/failed counts and the configured maximum when available |
| Stop reason | Explain completion, cancellation, timeout, or budget exhaustion in plain language |

Do not put every counter in the default prompt line. Avoid dollar-cost figures unless the provider and model pricing are known and current. These are task-run metrics, not host CPU, RAM, or process metrics.

### Tool activity

Show a concise action summary, tool name, and outcome. Keep raw command output and large search results collapsed or bounded by default. Tool output is untrusted data and must remain visually distinct from Oden’s own explanation.

### Approval prompt

Approval requests are the highest-priority screen state. Show the exact action, target, workspace, risk, and reason; provide clear Approve and Deny/Cancel choices.

```text
APPROVAL REQUIRED · HIGH RISK
Action: Overwrite an existing file
Target: src/config/settings.ts
Workspace: ~/work/my-app
Reason: The requested change replaces existing content.

[ A ] Approve once     [ D ] Deny     [ Esc ] Cancel
```

Do not use color as the only risk signal. Keep denial and cancellation easy to find. Never imply that an action ran before approval was granted.

### Completion summary

End coding tasks with a compact summary containing:

- what changed;
- checks actually run and their results;
- files changed, when available;
- any unresolved issue or action requiring the user.

Do not claim tests, commits, pushes, or deployments succeeded without evidence. A future diff panel may expose exact edits, but the completion summary should remain useful without one.

### Run metrics panel

Use compact budget meters for model requests, tool invocations, token use, and elapsed time. Each bar must use its actual counter and configured limit. Keep observed token usage and estimated usage visibly distinct. Use green below half of the budget, yellow as usage approaches the limit, and red near or above 80%; always show the numeric values beside the meter. Show retries and a stop reason only when present. Do not show cost unless the provider pricing is known, and do not show machine CPU, RAM, network, or process metrics.

### Errors and provider limits

- Explain whether the failure occurred during guardrails, routing, provider request, tool execution, approval, or output validation when that information is available.
- Show a short user-facing message first; keep sanitized diagnostic details available on request.
- For rate limits/timeouts, show retry state only when a retry is actually happening. Otherwise explain that the user can retry later or select another configured provider.
- Never show credentials, raw authorization headers, or unredacted provider secrets.

### Slash commands and setup

Render slash commands as compact text help with purpose and usage. Provider and API-key prompts must make it clear which provider is selected; key entry is hidden. `/status` masks all keys. Setup mode should point users to `/provider` without presenting unavailable commands as active.

## 6. Symbols and borders

Use btop-inspired framed panels with a small, consistent symbol set and text fallbacks. Keep frames thin, use one semantic accent per panel, and use dotted separators for inline activity:

| Meaning | Preferred | Fallback |
|---|---|---|
| Completed | `✓` | `[done]` |
| Working | `◌` | `...` |
| Failed | `✕` | `[failed]` |
| Warning/approval | `!` | `[!]` |
| Cancelled | `Ⅱ` | `[cancelled]` |
| Indent/tree | `├─`, `└─` | `-` |
| Divider | `╎`, `─` | `|`, `-` |

For state labels, use explicit words alongside symbols: `○ QUEUED`, `◌ RUNNING`, `↻ RETRYING`, `✓ COMPLETED`, `! AWAITING APPROVAL`, `Ⅱ CANCELLED`, and `✕ FAILED`. Only show `RETRYING` while a retry is active. If a symbol is unsupported, use its text fallback.

Use rounded box corners and an embedded title notch where terminal support allows. Use colored meters for real task-run budgets and state colors for activity. Avoid dense, full-screen process tables and host-resource graphs; Oden should visualize its work and its own request budgets, not the user's machine.

## 7. Motion and live updates

- Use a subtle spinner or static active marker only while an operation is active; stop it immediately on completion, failure, or cancellation.
- Stream text incrementally without replacing prior content.
- Update activity in place only when the terminal renderer can do so reliably; otherwise append concise event lines.
- Respect reduced-motion and non-interactive environments by using static text status.
- Do not animate decorative transitions or show fake progress percentages for work without measurable progress.

## 8. Accessibility and terminal compatibility

- All states must remain understandable with color disabled.
- Keep contrast high and avoid faint text for actionable information.
- Do not use emoji as the only status indicator; provide a text label.
- Keep keyboard choices explicit and consistent; support Escape/Ctrl+C cancellation where the operation permits it.
- Preserve screen-reader-friendly plain output and avoid full-screen redraws unless a dedicated TUI renderer is introduced.
- Use Unicode symbols when supported, with ASCII fallbacks.

## 9. Do and don’t

### Do

- Make workspace, session, provider, and current action easy to identify.
- Keep the user request and streamed answer visually primary.
- Show approvals before execution and outcomes after execution.
- Keep activity summaries concise and factual.
- Make failure and cancellation states recoverable and explicit.

### Don’t

- Turn the interface into CPU, memory, network, or process monitoring.
- Maximize data density at the expense of task comprehension.
- Put a separate accent color on every component.
- Display fake metrics, token counts, progress percentages, or tool events.
- Hide the active workspace or make Oden’s own repository an accidental default target.
- Imply a tool action, test, approval, or Git operation succeeded when it did not.

## 10. Prompt guide for UI implementation

```text
Design Oden as a polished terminal coding-agent interface inspired by btop's
framed panels, crisp hierarchy, semantic color, and compact meters. Use a calm
dark-terminal palette with distinct but restrained accents. Keep the task
conversation in a readable single column. Frame workspace/session/provider
context, show live tool and specialist activity, and use real request/tool/
token/time budgets for compact meters. Make approvals and verified outcomes
clear. Support narrow terminals, no-color mode, and Unicode/ASCII fallbacks.
Do not add host CPU/memory graphs, fake progress, cost guesses, or decorative
full-screen redraws.

Use coding-agent components such as a run header, event timeline, tool tags,
approval prompt, specialist status rows, change summary, validation results,
and expandable per-run usage details. Show only state and metrics supplied by
the harness; distinguish observed values from estimates, and keep counters
secondary to the task conversation.
```
