import { describe, test, expect } from "vitest";
import { createWebServer } from "@/web/server";
import type { StatusProvider, BotStatus, SessionInfo } from "@/web/server";
import type { ServerConfig } from "@/types/config";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const defaultConfig: ServerConfig = {
  port: 3000,
  host: "localhost",
};

const onlineStatus: BotStatus = {
  online: true,
  uptime: 3600000,
  lastMessageAt: 1714400000000,
};

const offlineStatus: BotStatus = {
  online: false,
  uptime: 0,
};

const sessions: SessionInfo[] = [
  {
    id: "sess-001",
    tool: "opencode",
    messageCount: 42,
    createdAt: 1714390000000,
  },
  {
    id: "sess-002",
    tool: "opencode",
    messageCount: 7,
    createdAt: 1714395000000,
  },
];

function makeProvider(
  overrides: {
    status?: BotStatus;
    sessions?: SessionInfo[];
    qrCode?: string | null;
  } = {}
): StatusProvider {
  return {
    getBotStatus: () => overrides.status ?? onlineStatus,
    getSessions: () => overrides.sessions ?? sessions,
    getQRCode: () =>
      overrides.qrCode !== undefined ? overrides.qrCode : null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createWebServer", () => {
  test("GET / returns HTML with bot status", async () => {
    const app = createWebServer(defaultConfig, makeProvider());
    const res = await app.request("/");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("Code-in-WeChat");
    expect(html).toContain("Online");
    expect(html).toContain("sess-001");
    expect(html).toContain("opencode");
    // Contains auto-refresh meta tag
    expect(html).toContain('http-equiv="refresh"');
  });

  test("GET / shows offline status and QR code when provided", async () => {
    const provider = makeProvider({
      status: offlineStatus,
      qrCode: "https://example.com/qr.png",
    });
    const app = createWebServer(defaultConfig, provider);
    const res = await app.request("/");

    const html = await res.text();
    expect(html).toContain("Offline");
    expect(html).toContain("QR Code Login");
    expect(html).toContain("https://example.com/qr.png");
  });

  test("GET /api/status returns JSON bot status", async () => {
    const app = createWebServer(defaultConfig, makeProvider());
    const res = await app.request("/api/status");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({
      online: true,
      uptime: 3600000,
      lastMessageAt: 1714400000000,
    });
  });

  test("GET /api/sessions returns JSON session array", async () => {
    const app = createWebServer(defaultConfig, makeProvider());
    const res = await app.request("/api/sessions");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toHaveLength(2);
    expect(body[0]).toEqual({
      id: "sess-001",
      tool: "opencode",
      messageCount: 42,
      createdAt: 1714390000000,
    });
  });

  test("GET /health returns 200 with status ok", async () => {
    const app = createWebServer(defaultConfig, makeProvider());
    const res = await app.request("/health");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });

  test("GET /api/sessions returns empty array when no sessions", async () => {
    const provider = makeProvider({ sessions: [] });
    const app = createWebServer(defaultConfig, provider);
    const res = await app.request("/api/sessions");

    const body = await res.json();
    expect(body).toEqual([]);
  });
});