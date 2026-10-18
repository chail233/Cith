# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SunbatwoBot is a OneBot v11 QQ bot (NapCat transport) that runs an LLM **agent** loop with tool calling, a multi-layer memory system, MCP tool extension, and a skill loader. AI backend is Aliyun Bailian (`workspace.aliyuncs.com`). Everything is ESM (`"type": "module"`, Node >= 24); imports use explicit `.js` extensions.

## Commands

- `npm start` — run the bot (`node src/index.js`). Needs a NapCat instance connecting to the reverse WebSocket at `ws://127.0.0.1:8080/onebot/v11/ws`.
- `npm run typecheck` — `tsc --noEmit`. **Currently broken as configured:** there is no `tsconfig.json` and TypeScript is not a dependency, so this fails. Types come from `jsconfig.json` + `// @ts-check` + JSDoc and are only checked in the editor. If you need CLI type-checking, add `typescript` + a `tsconfig.json` first; don't assume this script works.
- There is **no test suite and no linter** configured. Verify changes by running the bot against a dev NapCat, or by reasoning about the pipeline (below).

### Config

All config lives in `core/config.js` (defaults, shared constants, and `SYSTEM_PROMPT`). When `DevMode: true` (the default), real secrets are loaded from `core/configDev.js` (gitignored). Merge rules: dev values overwrite base, **but `mcpServers` is concatenated** (base first). If `DevMode` is true and `configDev.js` is missing, the process exits(1) at import time. `core/app.pem` is also gitignored.

## Architecture

### Event pipeline

`NapCat → bot/server.js (WS) → bot/adapter/OnebotAdapter → pipeline/index.js`.

- `pipeline/context.js` builds `ctx` for each event: `{ event, adapter, text, userId, senderName, isAdmin, isTargetGroup, isAtBot, imageDescription, handled }`. Only group messages from `config.targetGroupId` proceed. `isAdmin` = user is `config.owner`.
- **Middleware** (`pipeline/middleware/`) all run in order and enrich `ctx`: `image-recognizer` (sets `ctx.imageDescription`), `at-detector` (sets `ctx.isAtBot`), `mini-program` (may set `ctx.handled = true` to short-circuit). Errors are caught and logged, never fatal.
- **Handlers** (`pipeline/handlers/`) run in order and the pipeline **stops at the first that returns `true`**: `keyword-commands → user-commands → ai-chat → repeater → proactive-chat`. Add new bot behavior by inserting a handler here, not by editing the loop.

### Adapters (`bot/adapter/`)

Transport protocols are abstracted behind `BaseAdapter` (an abstract class). It owns the `pipeline` callback, exposes `onMessage()` (feeds a normalized `CtxEvent` into the pipeline) and declares `sendMsg()` abstract. `OnebotAdapter` implements the OneBot v11 wire format (`sendAction`/`sendMsg` over the WebSocket). To support a new chat platform, subclass `BaseAdapter` and implement `sendMsg()` — the pipeline and handlers stay unchanged because they only ever talk to the `BaseAdapter` contract. Keep transport-specific state (e.g. the `ws` socket) in the concrete subclass, not in the base.

### Shared types (`core/types/`)

Cross-module type contracts live in `core/types/index.ts`: `CtxEvent` (normalized inbound event), `Space` (group/private target), `Context` (pipeline ctx), and `MessageSegment`. This is the **single source of truth** — the adapter layer and the pipeline both import from it; do not redefine these interfaces locally. `CtxEvent.adapter` / `Context.adapter` are typed as `BaseAdapter` so `ctx.adapter.sendMsg()` is type-checked (type-only circular imports between `types` and `BaseAdapter` are fine — they are erased at runtime).

### Agent loop (`agent/Agent.ts`, merged AI module — former `llm/` now lives in `agent/`)

`Agent` (an `EventEmitter`, one per chat session, pooled by `agent/AgentManager.ts`) owns the loop: `contextBuilder.ts` `buildMessages()` assembles system prompt + force-loaded skills + skill list + MCP server list + optional mid-summary + active plan + recorder history; the LLM is called with all tool definitions; for each `tool_calls` entry `callTool()` runs and the result is appended as a `role:"tool"` row, then the LLM is called again — looping up to `config.TOOLCHAIN_MAX_LENGTH` (30). The Agent only *thinks*: it broadcasts `reply` / `tool-call` / `tool-result` events; `pipeline/agent-runner.ts` (`runAgent(ctx)`) subscribes and sends via the adapter with ~3s random spacing. The model must output strict JSON `{ "action": [{ "cmd": "text", "content": "..." }] }`; `replyParser.ts` `parseReply()` is lenient — it also accepts a bare array and degrades malformed output to a single text message.

### Tools (`agent/tools.js`)

Local tools are declared in the `tools` array and dispatched through the `toolMap`; `callTool(tool_call, ctx, confirmed)` is the single entry point. MCP tools are exposed as `mcp_<originalName>` and routed by prefix to `mcpClient`. `getAllTools()` is **stateful**: it appends any dynamically-loaded MCP tools and then clears them — MCP tools only exist after the model calls `list_mcp_tools` for that server.

When adding a tool, update **both** the `tools` array and `toolMap`. If it is a file-path tool, also register it in `pathToolWhitelist` (a map of tool name → `{ dirKey, pathKey }` pointing at its whitelist config and its path argument) — that map drives the gate below.

### Approval gate (`agent/tool-approval.js` + path-aware whitelist)

The gate is centralized in `callTool()` and is **path-aware, not tool-name based** (the old `config.gatedTools` is retired). For a **non-admin** call to any file tool in `pathToolWhitelist`, the resolved target path is checked against that tool's whitelist (`readFileDirs` / `runJsDirs` / `editFileDirs`): **inside the whitelist → run immediately** (so scripts under `skills/`, writes under `workspace/`, etc. are never blocked); **outside the whitelist → held** (id assigned, 10-minute timeout) pending an admin `#do-yes <id>` (`#do-no` cancels); the confirmed-execution chain lives in `agent/approval-runner.ts` (`take()` dequeues, the target session's Agent executes and writes the result back to memory). Admins (`config.owner`) and already-confirmed calls bypass the gate. Path traversal out of `core/` is still hard-rejected by `resolveSrcPath` (never held, never allowed). MCP tools have no local path target and are not covered by this gate.

### Memory (`agent/recorder.js` + `agent/long-term-memory.js`)

Each `Agent` holds its own `ChatRecorder` (session pool with idle-recapture in `AgentManager.ts`). Four layers: short-term `_messages` (`config.CHAT_HISTORY_LIMIT`) → evicted into `_cache` → once cache reaches the limit, `summarizeCache()` (invoked at the top of each `Agent.run()`) LLM-summarizes it into `_midSummary` → before an old summary is overwritten it is written to the cloud long-term memory along with extracted per-user profiles. The model recalls via the `get_memory` and `get_user_profile` tools (session access comes from `ctx.agent`). `compress()` and `clear()` are wired to `#compress` / `#clear`.

### File security (`utils/file-security.js`)

Every file tool resolves its path **relative to `core/`** via `resolveSrcPath`, which rejects `..` traversal out of `core/` (hard floor). The per-operation whitelist (`config.readFileDirs` / `runJsDirs` / `editFileDirs`, default `skills` and `workspace`) is enforced **in `callTool()`'s gate** (via `checkPathWhitelist`), not inside each tool — a tool body no longer re-checks it. `run_JS` runs the script in a child process with a 30s timeout. Do not bypass these helpers to touch files outside the whitelist without going through the approval gate.

### Skills (`agent/skill.js`)

A skill is a directory under `core/skills/` containing `SKILL.md` with YAML frontmatter (`name`, `description`); the parsed list is injected into every prompt as the "技能列表". Executable logic goes in `scripts/` and is run through `run_JS`. `reloadSkills()` re-scans at runtime (`#reloadskls`). `core/skill-manager` installs/uninstalls community skills from GitHub.

### Services and MCP

`services/` holds thin HTTP wrappers (napcat, acg, hitokoto, qweather, Bailian model list). `agent/mcp-client.js` manages MCP connections over `stdio` / `old_sse` (SSE) / `sse` (Streamable HTTP); `shutdown()` is called on SIGINT/SIGTERM/uncaughtException in `index.js` to avoid zombie child processes. `mcp/` is **gitignored** — it holds local MCP servers (e.g. `mcp/github-server`).

## Conventions

- Comments, log strings, and the `SYSTEM_PROMPT` are in Chinese; keep new code consistent.
- New cross-module interfaces go in `core/types/index.ts` (not redefined per module); new chat platforms are added by subclassing `BaseAdapter` in `bot/adapter/`.
- Use `utils/logger.js` rather than `console`.
- `config.SYSTEM_PROMPT` defines both the persona and the strict JSON output contract — changes there affect every reply.