# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

SunbatwoBot is a OneBot v11 QQ bot (NapCat transport) that runs an LLM **agent** loop with tool calling, a multi-layer memory system, MCP tool extension, and a skill loader. AI backend is Aliyun Bailian (`workspace.aliyuncs.com`). Everything is ESM (`"type": "module"`, Node >= 24); imports use explicit `.js` extensions.

## Commands

- `npm start` — run the bot (`node src/index.js`). Needs a NapCat instance connecting to the reverse WebSocket at `ws://127.0.0.1:8080/onebot/v11/ws`.
- `npm run typecheck` — `tsc --noEmit`. **Currently broken as configured:** there is no `tsconfig.json` and TypeScript is not a dependency, so this fails. Types come from `jsconfig.json` + `// @ts-check` + JSDoc and are only checked in the editor. If you need CLI type-checking, add `typescript` + a `tsconfig.json` first; don't assume this script works.
- There is **no test suite and no linter** configured. Verify changes by running the bot against a dev NapCat, or by reasoning about the pipeline (below).

### Config

All config lives in `src/config.js` (defaults, shared constants, and `SYSTEM_PROMPT`). When `DevMode: true` (the default), real secrets are loaded from `src/configDev.js` (gitignored). Merge rules: dev values overwrite base, **but `mcpServers` and `gatedTools` are concatenated** (base first). If `DevMode` is true and `configDev.js` is missing, the process exits(1) at import time. `src/app.pem` is also gitignored.

## Architecture

### Event pipeline

`NapCat → bot/server.js (WS) → bot/adapter/OnebotAdapter → pipeline/index.js`.

- `pipeline/context.js` builds `ctx` for each event: `{ event, adapter, text, userId, senderName, isAdmin, isTargetGroup, isAtBot, imageDescription, handled }`. Only group messages from `config.targetGroupId` proceed. `isAdmin` = user is `config.owner`.
- **Middleware** (`pipeline/middleware/`) all run in order and enrich `ctx`: `image-recognizer` (sets `ctx.imageDescription`), `at-detector` (sets `ctx.isAtBot`), `mini-program` (may set `ctx.handled = true` to short-circuit). Errors are caught and logged, never fatal.
- **Handlers** (`pipeline/handlers/`) run in order and the pipeline **stops at the first that returns `true`**: `keyword-commands → user-commands → ai-chat → repeater → proactive-chat`. Add new bot behavior by inserting a handler here, not by editing the loop.

### Adapters (`bot/adapter/`)

Transport protocols are abstracted behind `BaseAdapter` (an abstract class). It owns the `pipeline` callback, exposes `onMessage()` (feeds a normalized `CtxEvent` into the pipeline) and declares `sendMsg()` abstract. `OnebotAdapter` implements the OneBot v11 wire format (`sendAction`/`sendMsg` over the WebSocket). To support a new chat platform, subclass `BaseAdapter` and implement `sendMsg()` — the pipeline and handlers stay unchanged because they only ever talk to the `BaseAdapter` contract. Keep transport-specific state (e.g. the `ws` socket) in the concrete subclass, not in the base.

### Shared types (`src/types/`)

Cross-module type contracts live in `src/types/index.ts`: `CtxEvent` (normalized inbound event), `Space` (group/private target), `Context` (pipeline ctx), and `MessageSegment`. This is the **single source of truth** — the adapter layer and the pipeline both import from it; do not redefine these interfaces locally. `CtxEvent.adapter` / `Context.adapter` are typed as `BaseAdapter` so `ctx.adapter.sendMsg()` is type-checked (type-only circular imports between `types` and `BaseAdapter` are fine — they are erased at runtime).

### Agent loop (`llm/chat.js`)

`buildMessages()` assembles: system prompt, skill list, MCP server list, optional mid-summary, then recorder history. The LLM is called with all tool definitions; for each `tool_calls` entry `callTool()` runs and the result is appended as a `role:"tool"` row, then the LLM is called again — looping up to `config.TOOLCHAIN_MAX_LENGTH` (30).

The model must output strict JSON `{ "action": [{ "cmd": "text", "content": "..." }] }`. `handleReply()` is lenient: it also accepts a bare array and degrades malformed output to a single text message. Multiple actions are sent with ~3s random spacing.

### Tools (`llm/tools.js`)

Local tools are declared in the `tools` array and dispatched through the `toolMap`; `callTool(tool_call, ctx, confirmed)` is the single entry point. MCP tools are exposed as `mcp_<originalName>` and routed by prefix to `mcpClient`. `getAllTools()` is **stateful**: it appends any dynamically-loaded MCP tools and then clears them — MCP tools only exist after the model calls `list_mcp_tools` for that server.

When adding a tool, update **both** the `tools` array and `toolMap`. Keep gated write-tools in `config.gatedTools`.

### Approval gate (`llm/tool-approval.js` + `config.gatedTools`)

`edit_file`, `create_file`, `delete_file`, `run_JS` called by a **non-admin** are held (id assigned, 10-minute timeout) and require an admin to send `#do-yes <id>` (`#do-no` cancels). Admins (`config.owner`) bypass the gate. This is a deliberate safety boundary — do not weaken it.

### Memory (`llm/recorder.js` + `llm/long-term-memory.js`)

Single exported instance `chatRecorder`. Four layers: short-term `_messages` (`config.CHAT_HISTORY_LIMIT`) → evicted into `_cache` → once cache reaches the limit, `summarizeCache()` (invoked at the top of each `chat()`) LLM-summarizes it into `_midSummary` → before an old summary is overwritten it is written to the cloud long-term memory along with extracted per-user profiles. The model recalls via the `get_memory` and `get_user_profile` tools. `compress()` and `clear()` are wired to `#compress` / `#clear`.

### File security (`utils/file-security.js`)

Every file tool resolves its path **relative to `src/`**, rejects traversal, and enforces a per-operation whitelist from `config.readFileDirs` / `runJsDirs` / `editFileDirs` (currently `skills` and `workspace`). `run_JS` runs the script in a child process with a 30s timeout. Do not bypass these helpers to touch files outside the whitelist.

### Skills (`llm/skill.js`)

A skill is a directory under `src/skills/` containing `SKILL.md` with YAML frontmatter (`name`, `description`); the parsed list is injected into every prompt as the "技能列表". Executable logic goes in `scripts/` and is run through `run_JS`. `reloadSkills()` re-scans at runtime (`#reloadskls`). `src/skill-manager` installs/uninstalls community skills from GitHub.

### Services and MCP

`services/` holds thin HTTP wrappers (napcat, acg, hitokoto, qweather, Bailian model list). `llm/mcp-client.js` manages MCP connections over `stdio` / `old_sse` (SSE) / `sse` (Streamable HTTP); `shutdown()` is called on SIGINT/SIGTERM/uncaughtException in `index.js` to avoid zombie child processes. `mcp/` is **gitignored** — it holds local MCP servers (e.g. `mcp/github-server`).

## Conventions

- Comments, log strings, and the `SYSTEM_PROMPT` are in Chinese; keep new code consistent.
- New cross-module interfaces go in `src/types/index.ts` (not redefined per module); new chat platforms are added by subclassing `BaseAdapter` in `bot/adapter/`.
- Use `utils/logger.js` rather than `console`.
- `config.SYSTEM_PROMPT` defines both the persona and the strict JSON output contract — changes there affect every reply.