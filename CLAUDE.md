# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development
bun run dev          # Start with watch mode
bun run build        # TypeScript compile to dist/
bun run start        # Run compiled version

# Testing
bun run test         # Run all tests (vitest run)
bun run test:watch   # Watch mode

# Type checking
bun run lint         # tsc --noEmit
```

## Architecture Overview

WeChat bot that bridges WeChat messages with AI coding tools (OpenCode). Data flow:

```
WeChat → iLink API → iLinkClient → MessageBridge → OpenCodeAdapter → OpenCode Server
                                    ↓
                              SessionManager (context_token cache, cursor persistence)
```

### Core Components

- **`src/index.ts`** — Entry point, startup orchestration (12-step init sequence)
- **`src/bridge/message-bridge.ts`** — Central message pipeline orchestrator
- **`src/bridge/session-manager.ts`** — Long-polling loop, context_token caching (24h TTL), cursor persistence
- **`src/bridge/auth-flow.ts`** — QR code login flow, bot_token persistence
- **`src/bridge/stream-handler.ts`** — SSE stream processing, text chunking (≤2000 chars for WeChat), typing indicators
- **`src/bridge/media-handler.ts`** — AES-128-ECB encryption/decryption for WeChat CDN media
- **`src/wechat/ilink-client.ts`** — iLink HTTP API client (native fetch, no external HTTP lib)
- **`src/tools/opencode.ts`** — OpenCode SDK adapter with SSE streaming
- **`src/daemon.ts`** — Process-level lifecycle: auto-reconnect, health monitoring, signal handling

### Key Patterns

- **Path alias**: `@/*` maps to `./src/*` (configured in tsconfig.json and vitest.config.ts)
- **Error classes**: Custom errors in `src/wechat/types.ts` — `SessionExpiredError` (ret=-14), `NetworkError`, `RateLimitError`
- **EventEmitter**: SessionManager and Daemon use EventEmitter for async event routing
- **Config validation**: Zod schemas in `src/config/env.ts`, all env vars validated at startup
- **Logging**: Structured logging via `createLogger(module)` in `src/log.ts`, auto-masks token/secret/key fields

### iLink API Notes

- Auth headers: `AuthorizationType: ilink_bot_token`, `Authorization: Bearer <token>`, `X-WECHAT-UIN: base64(randomUint32)`
- Session expiry: API returns `ret=-14`, handled by `SessionExpiredError`
- AES key formats differ: image keys are base64(raw 16 bytes), file/voice/video keys are base64(hex string)

### OpenCode Streaming

The correct flow (critical — see `sendAndStream()`):
1. Subscribe to SSE events first
2. Send prompt WITHOUT awaiting
3. Collect streaming events in parallel
4. Return when session becomes idle

## Configuration

Required env var: `SESSION_DB_PATH` (path to persist session/cursor data)

Optional: `ILINK_BASE_URL`, `OPENCODE_PORT`, `OPENCODE_HOSTNAME`, `OPENCODE_MODEL`, `SERVER_PORT`, `SERVER_HOST`, `LOG_LEVEL`, `BOT_TOKEN_PATH`
