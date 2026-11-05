# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SunbatwoBot is a OneBot v11 QQ bot (NapCat transport) that runs an LLM **agent** loop with tool calling, a multi-layer memory system, MCP tool extension, and a skill loader. AI backend is Aliyun Bailian (`workspace.aliyuncs.com`). Everything is ESM (`"type": "module"`, Node >= 24); imports use explicit `.js` extensions.

## Commands

- `npm start` — run the bot (`node src/index.js`). Needs a NapCat instance connecting to the reverse WebSocket at `ws://127.0.0.1:8080/onebot/v11/ws`.
- `npm run typecheck` — `tsc --noEmit`. **Currently broken as configured:** there is no `tsconfig.json` and TypeScript is not a dependency, so this fails. Types come from `jsconfig.json` + `// @ts-check` + JSDoc and are only checked in the editor. If you need CLI type-checking, add `typescript` + a `tsconfig.json` first; don't assume this script works.
- There is **no test suite and no linter** configured. Verify changes by running the bot against a dev NapCat, or by reasoning about the pipeline (below).

### Config

All config defaults live in `core/config.js` (shared constants); real secrets live in `core/config.json` (gitignored; path overridable via the `CITH_CONFIG` env var). Startup merges `config.js → config.json`: scalars and arrays replace, plain objects merge one level, `members` (object → `Map`) is normalized, and keys starting with `$` or `_` act as comments. `mcpServers` is the one array that merges **incrementally by `name`** instead of being replaced: user entries keep their written order, a same-`name` entry wholesale overrides the matching default entry, unmatched user entries are appended, remaining defaults are filled in after them, and `"disabled": true` on a user entry drops that default. `command: "$NODE"` is rewritten to `process.execPath` in **both** layers — the default list is resolved right after `baseConfig` is declared, because defaults never pass through the user-config normalizer. A malformed `config.json` aborts startup. Runtime top-level assignments are written back to `config.json` (except `members` / `mcpServers`). `core/app.pem` is also gitignored.

The system prompt is not a config value: it lives at the fixed path `core/prompts/system.md`, re-read on
every turn so edits take effect without a restart. There is no fallback —
when the file is missing no system message is injected at all (and the `systemPrompt` / `SYSTEM_PROMPT` keys
are dropped from `config.json` at load). The panel's Prompt page writes the file through
`get_prompt` / `set_prompt`; `set_config` deliberately cannot touch it.

## Architecture

### Event pipeline

`NapCat → bot/server.js (WS) → bot/adapter/OnebotAdapter → pipeline/index.js`.

- `pipeline/context.js` builds `ctx` for each event: `{ event, adapter, text, userId, senderName, isAdmin, isTargetGroup, at, imageDescription, handled }`. Only group messages from `config.targetGroupId` proceed. `isAdmin` = user is `config.owner`.
- **Middleware** (`pipeline/middleware/`) all run in order and enrich `ctx`: `image-recognizer` (sets `ctx.imageDescription`), `at-detector` (sets `ctx.at` to the @ target's name, `"我"` when the bot is @'d), `mini-program` (may set `ctx.handled = true` to short-circuit). Errors are caught and logged, never fatal.
- **Handlers** (`pipeline/handlers/`) run in order and the pipeline **stops at the first that returns `true`**: `keyword-commands → user-commands → ai-chat → proactive-chat`. Add new bot behavior by inserting a handler here, not by editing the loop.

### Adapters (`bot/adapter/`)

Transport protocols are abstracted behind `BaseAdapter` (an abstract class). It owns the `pipeline` callback, exposes `onMessage()` (feeds a normalized `CtxEvent` into the pipeline) and declares `sendMsg()` abstract. `OnebotAdapter` implements the OneBot v11 wire format (`sendAction`/`sendMsg` over the WebSocket). To support a new chat platform, subclass `BaseAdapter` and implement `sendMsg()` — the pipeline and handlers stay unchanged because they only ever talk to the `BaseAdapter` contract. Keep transport-specific state (e.g. the `ws` socket) in the concrete subclass, not in the base.

### Shared types (`core/types/`)

Cross-module type contracts live in `core/types/index.ts`: `CtxEvent` (normalized inbound event), `Space` (group/private target), `Context` (pipeline ctx), and `MessageSegment`. This is the **single source of truth** — the adapter layer and the pipeline both import from it; do not redefine these interfaces locally. `CtxEvent.adapter` / `Context.adapter` are typed as `BaseAdapter` so `ctx.adapter.sendMsg()` is type-checked (type-only circular imports between `types` and `BaseAdapter` are fine — they are erased at runtime). Agent-specific types (`ToolCall`, `LlmResult`, `ReplyAct`, `ReplyPayload`, `PendingToolCall`, `Plan`/`PlanItem`/`PlanStatus`/`RawTodo`) live in `core/agent/types.ts` — only the AI module and its event consumers (`pipeline/agent-runner.ts`) import from there.

### Agent loop (`agent/Agent.ts`, merged AI module — former `llm/` now lives in `agent/`)

`Agent` (an `EventEmitter`, one per chat session, pooled by `agent/AgentManager.ts`) owns the loop: `contextBuilder.ts` `buildMessages(agent)` (reads `agent.memory` + `agent.getActivePlan()`) assembles system prompt + force-loaded skills + skill list + MCP server list + optional mid-summary + recorder history + a volatile tail (active plan, wake trigger). Ordering is prefix-cache driven: stable content first, volatile content last, so a plan status flip or a wake-up only invalidates the new tail instead of re-billing the whole history. The LLM is called with all tool definitions; for each `tool_calls` entry `callTool()` runs and the result is appended as a `role:"system"` trace message, then the LLM is called again — looping up to `config.toolChainMaxLength` (30). The Agent only *thinks*: it broadcasts `reply` / `tool-call` / `tool-result` events; `pipeline/agent-runner.ts` (`runAgent(ctx)`) subscribes and sends via the adapter with ~3s random spacing. The model must output strict JSON `{ "action": [{ "cmd": "text", "content": "..." }] }`; `replyParser.ts` `parseReply()` is lenient — it also accepts a bare array and degrades malformed output to a single text message.

### Tools (`agent/tools.js`)

Local tools are one module each under `agent/tools/` (exporting `definition` for the model and `execute`), assembled into `toolRegistry` in `agent/tools.js` (which derives the `tools` array and `toolMap`); `callTool(tool_call, ctx, confirmed)` is the single entry point. MCP tools use server-qualified names returned by `mcpClient`, which routes them to the original server and tool. Legacy `mcp_<originalName>` calls work only for unambiguous names. `getAllTools()` returns the local tools plus `mcpClient.getActiveToolDefinitions()` — MCP tools exist only for servers in the **activation list** (`mcpClient.activeServers`, an insertion-ordered `Set`) that the model maintains through the single `manage_mcp` tool (`activate` / `deactivate`; the server list itself is already injected into every prompt by `contextBuilder.ts`, so there is no `list` action). `activate()` re-lists that server's tools into `_toolCache` and adds it to the set; `deactivate()` removes it. There is no one-shot queue anymore, so the tool array is byte-identical while the activation list is unchanged (prefix-cache friendly) and activated tools stay callable across rounds. `callTool` routing goes through `toolServerMap` (fully populated at init), so an un-activated server's tool is still callable — activation only controls what the model *sees*.

`report_progress` lets the model narrate what it is doing during long task chains instead of staying silent: it delegates to `Agent.narrate()`, which emits a text act through the **same `reply` event chain** as normal replies (so ordering and pacing stay consistent) and records it to memory like any other assistant message; identical text repeated within 60s is suppressed.

When adding a tool, create the module and register it in `toolRegistry`. If it is a file-path tool, also register it in `pathToolWhitelist` (a map of tool name → `{ dirKey, pathKey }` pointing at its whitelist config and its path argument) — that map drives the gate below.

### Approval gate (`agent/tool-approval.js` + path-aware whitelist)

The gate is centralized in `callTool()` and is **path-aware, not tool-name based** (the old `config.gatedTools` is retired). For a **non-admin** call to any file tool in `pathToolWhitelist`, the resolved target path is checked against that tool's whitelist (`readFileDirs` / `runJsDirs` / `editFileDirs`): **inside the whitelist → run immediately** (so scripts under `skills/`, writes under `workspace/`, etc. are never blocked); **outside the whitelist → held** (id assigned, 10-minute timeout) pending an admin `#do-yes <id>` (`#do-no` cancels); the confirmed-execution chain lives in `agent/approval-runner.ts` (`take()` dequeues, the target session's Agent executes and writes the result back to memory). Admins (`config.owner`) and already-confirmed calls bypass the gate. Path traversal out of `core/` is still hard-rejected by `resolveSrcPath` (never held, never allowed). MCP tools have no local path target and are not covered by this gate.

### Memory (`agent/recorder.js` + `agent/long-term-memory.js`)

Each `Agent` holds its own `ChatRecorder` (session pool with idle-recapture in `AgentManager.ts`). Layers: short-term `_messages` (never trimmed by count; serialized size is maintained incrementally in `_chars` and exposed as `estimatedTokens`) → when a whole `Agent.run()` finishes and `estimatedTokens` exceeds `config.chatSummaryThresholdTokens` (the **chat threshold**), `maybeSummarize()` starts `_summarize()` **without awaiting** so listener detach and the next turn are never blocked: the LLM (`_extractFacts()`, one fact per line parsed by `parseFacts()`) extracts facts from all but the newest ~30% of the payload (`KEEP_TAIL_RATIO`), each fact is written to the local rememori store **one memory per fact** via `addFacts()`, and only then are the summarized messages dropped and `_midSummary` (rolling window of `MAX_SUMMARY_FACTS` = 60 lines) updated; if the model yields no facts the original messages are kept. A snapshot is taken first, so messages added during summarization are neither summarized nor deleted. `services/memory-store.ts` opens the rememori file **once per process** (`initMemoryStore()` in `index.js`, `closeMemoryStore()` on shutdown) and serializes all writes; the embedder is chosen by `memoryEmbedProvider` ("ollama" = local Ollama via `memoryOllamaUrl`, "openai" = any OpenAI-compatible `/embeddings` endpoint via `memoryEmbedBaseUrl` + `memoryEmbedApiKey`); rememori has no file lock, so never open the same `.mem` file from another process. Switching provider/model invalidates all stored vectors (delete the `.mem` file to rebuild). Recall goes through the `get_memory` tool (`searchMemory()` in `agent/long-term-memory.js`): the model may pass a `queries` string array (max 5, each recalled separately, merged and deduped keeping the best similarity, then capped at `memorySearchTopK`); with no queries or an empty array it derives up to 5 queries from the recent messages of the session (texts shorter than 2 chars are skipped). **No tags are used**, so long-term memory is shared across all sessions (only short/mid-term memory is per-session). `compress()` (forced summarization that ignores the chat threshold) is used by `#compress` and before session retirement; `clear()` is wired to `#clear`. Tool-call traces are stored as `role: "system"` messages; `compactIfNeeded(config.contextBudgetTokens)` (the **work threshold**, called in `Agent.run()` before every request) folds the oldest `system` messages into a `[已折叠] <first 200 chars>…[省略 N 字]…<last 100 chars>` form until the payload drops below half the budget (batching to avoid rewriting the history more than necessary, which would break provider prefix caching). Folding is pure in-memory, idempotent via the `[已折叠]` prefix, skips texts under 800 chars, and never touches user/assistant messages — the model can always re-invoke the tool to recover the content.

### File security (`utils/file-security.js`)

Every file tool resolves its path **relative to `core/`** via `resolveSrcPath`, which rejects `..` traversal out of `core/` (hard floor). The per-operation whitelist (`config.readFileDirs` / `runJsDirs` / `editFileDirs`, default `skills` and `workspace`) is enforced **in `callTool()`'s gate** (via `checkPathWhitelist`), not inside each tool — a tool body no longer re-checks it. `run_JS` runs the script in a child process with a 30s timeout. Do not bypass these helpers to touch files outside the whitelist without going through the approval gate.

### Skills (`agent/skill.js`)

A skill is a directory under `core/skills/` containing `SKILL.md` with YAML frontmatter (`name`, `description`); the parsed list is injected into every prompt as the "技能列表". Executable logic goes in `scripts/` and is run through `run_JS`. `reloadSkills()` re-scans at runtime (`#reloadskls`). `core/skill-manager` installs/uninstalls community skills from GitHub.

### Services and MCP

`services/` holds thin HTTP wrappers (napcat, acg, hitokoto, qweather, Bailian model list), the scheduler, and the rememori memory store. `agent/mcp-manager.js` manages MCP connections over `stdio` / `old_sse` (SSE) / `sse` (Streamable HTTP); `shutdown()` is called on SIGINT/SIGTERM/uncaughtException in `index.js` to avoid zombie child processes. `mcp/` is **gitignored** — it holds local MCP servers (e.g. `mcp/github-server`).

## Conventions

- Comments, log strings, and the system prompt file are in Chinese; keep new code consistent.
- New cross-module interfaces go in `core/types/index.ts`, Agent-only types in `core/agent/types.ts` (not redefined per module elsewhere); new chat platforms are added by subclassing `BaseAdapter` in `bot/adapter/`.
- Use `utils/logger.js` rather than `console`.
- `core/prompts/system.md` defines both the persona and the strict JSON output contract — changes there affect every reply. `services/prompt-store.ts` only does type/IO checks (no content validation), so a bad edit is saved as written.
