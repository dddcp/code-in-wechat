import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AuthFlow } from "../../src/bridge/auth-flow.js";
import type { iLinkClient } from "../../src/wechat/ilink-client.js";
import type {
  iLinkQRCodeResponse,
  iLinkQRCodeStatusResponse,
} from "../../src/wechat/types.js";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock iLinkClient with all methods stubbed */
function createMockClient(): iLinkClient {
  return {
    getBotQRCode: vi.fn(),
    getQRCodeStatus: vi.fn(),
    getUpdates: vi.fn(),
    sendMessage: vi.fn(),
    sendTyping: vi.fn(),
    getConfig: vi.fn(),
    getUploadUrl: vi.fn(),
  } as unknown as iLinkClient;
}

/** Create a temp file path for token storage */
function tempTokenPath(): string {
  return path.join(os.tmpdir(), `auth-flow-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

/** Standard QR code response */
const mockQRResponse: iLinkQRCodeResponse = {
  qrcode: "qr-code-123",
  qrcode_img_content: "base64-image-data",
};

/**
 * Flush the microtask queue by yielding multiple times.
 * Required because vi.advanceTimersByTime() fires timer callbacks
 * synchronously but promise continuations are microtasks that need
 * to be flushed separately.
 */
async function flushPromises(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Test: Login flow (QR → poll → confirmed)
// ---------------------------------------------------------------------------

describe("AuthFlow.login", () => {
  let mockClient: iLinkClient;
  let tokenPath: string;

  beforeEach(() => {
    mockClient = createMockClient();
    tokenPath = tempTokenPath();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await fs.unlink(tokenPath);
    } catch {
      // ignore
    }
  });

  it("should complete full login flow: get QR → poll wait → poll confirmed → save token", async () => {
    (mockClient.getBotQRCode as ReturnType<typeof vi.fn>).mockResolvedValue(mockQRResponse);

    // First poll: still waiting, second poll: confirmed
    const statusWait: iLinkQRCodeStatusResponse = { status: "wait" };
    const statusConfirmed: iLinkQRCodeStatusResponse = {
      status: "confirmed",
      bot_token: "bot-token-abc",
      baseurl: "https://ilink.example.com",
    };
    (mockClient.getQRCodeStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(statusWait)
      .mockResolvedValueOnce(statusConfirmed);

    const displayed: Array<{ qrcode: string; qrcodeImgContent: string }> = [];
    const authFlow = new AuthFlow(mockClient, {
      botTokenPath: tokenPath,
      pollIntervalMs: 2000,
      qrCodeDisplayer: (data) => displayed.push(data),
    });

    const resultPromise = authFlow.login();

    // Flush: getBotQRCode resolves → display QR → enter while loop → getQRCodeStatus("wait") → sleep(2000)
    await flushPromises();

    // Advance past first poll interval
    vi.advanceTimersByTime(2000);
    // Flush: sleep resolves → getQRCodeStatus("confirmed") → save token → return
    await flushPromises();

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.botToken).toBe("bot-token-abc");
    expect(result.baseUrl).toBe("https://ilink.example.com");
    expect(authFlow.getState()).toBe("confirmed");

    // Verify QR code was displayed
    expect(displayed).toHaveLength(1);
    expect(displayed[0].qrcode).toBe("qr-code-123");

    // Verify token was saved to file
    const saved = JSON.parse(await fs.readFile(tokenPath, "utf-8"));
    expect(saved.bot_token).toBe("bot-token-abc");
    expect(saved.base_url).toBe("https://ilink.example.com");
  });

  it("should transition through states: unauthenticated → qrcode_displayed → scanned → confirmed", async () => {
    (mockClient.getBotQRCode as ReturnType<typeof vi.fn>).mockResolvedValue(mockQRResponse);

    const statusWait: iLinkQRCodeStatusResponse = { status: "wait" };
    const statusScanned: iLinkQRCodeStatusResponse = { status: "scaned" };
    const statusConfirmed: iLinkQRCodeStatusResponse = {
      status: "confirmed",
      bot_token: "bot-token-xyz",
      baseurl: "https://ilink2.example.com",
    };
    (mockClient.getQRCodeStatus as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(statusWait)
      .mockResolvedValueOnce(statusScanned)
      .mockResolvedValueOnce(statusConfirmed);

    const states: string[] = [];
    const authFlow = new AuthFlow(mockClient, {
      botTokenPath: tokenPath,
      pollIntervalMs: 1000,
      qrCodeDisplayer: () => {
        states.push(authFlow.getState());
      },
    });

    const resultPromise = authFlow.login();
    // Initial state should be unauthenticated
    expect(authFlow.getState()).toBe("unauthenticated");

    // Flush: getBotQRCode resolves → display QR (captures "qrcode_displayed") → enter while loop → getQRCodeStatus("wait") → sleep(1000)
    await flushPromises();

    // Advance past first poll interval (wait → scanned)
    vi.advanceTimersByTime(1000);
    await flushPromises();

    // Advance past second poll interval (scanned → confirmed)
    vi.advanceTimersByTime(1000);
    await flushPromises();

    const result = await resultPromise;

    // After getBotQRCode, state should be qrcode_displayed (captured in displayer)
    expect(states).toContain("qrcode_displayed");
    // Final state should be confirmed
    expect(authFlow.getState()).toBe("confirmed");
    expect(result.success).toBe(true);
  });

  it("should timeout after 5 minutes with expired state", async () => {
    (mockClient.getBotQRCode as ReturnType<typeof vi.fn>).mockResolvedValue(mockQRResponse);
    // Always return "wait" — never confirmed
    (mockClient.getQRCodeStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ status: "wait" });

    const authFlow = new AuthFlow(mockClient, {
      botTokenPath: tokenPath,
      pollIntervalMs: 2000,
      timeoutMs: 300_000, // 5 minutes
      qrCodeDisplayer: () => {},
    });

    const resultPromise = authFlow.login();

    // Flush initial setup
    await flushPromises();

    // Advance 5 minutes — this fires all pending timers at once
    vi.advanceTimersByTime(300_000);
    await flushPromises();

    const result = await resultPromise;

    expect(result.success).toBe(false);
    expect(result.error).toContain("timed out");
    expect(authFlow.getState()).toBe("expired");
  });

  it("should handle network error during getBotQRCode", async () => {
    (mockClient.getBotQRCode as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Network error: connection refused"),
    );

    const authFlow = new AuthFlow(mockClient, {
      botTokenPath: tokenPath,
      qrCodeDisplayer: () => {},
    });

    const result = await authFlow.login();

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
    expect(authFlow.getState()).toBe("error");
  });

  it("should retry on NetworkError during polling and succeed on confirmed", async () => {
    (mockClient.getBotQRCode as ReturnType<typeof vi.fn>).mockResolvedValue(mockQRResponse);

    const { NetworkError } = await import("../../src/wechat/types.js");
    const statusConfirmed: iLinkQRCodeStatusResponse = {
      status: "confirmed",
      bot_token: "bot-token-retry",
      baseurl: "https://ilink-retry.example.com",
    };

    // First poll: network error (retryable)
    // Second poll: confirmed
    (mockClient.getQRCodeStatus as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new NetworkError(new Error("timeout")))
      .mockResolvedValueOnce(statusConfirmed);

    const authFlow = new AuthFlow(mockClient, {
      botTokenPath: tokenPath,
      pollIntervalMs: 1000,
      qrCodeDisplayer: () => {},
    });

    const resultPromise = authFlow.login();

    // Flush: getBotQRCode resolves → display QR → enter while loop → getQRCodeStatus throws NetworkError → sleep(1000)
    await flushPromises();

    // Advance past first poll interval (network error → retry)
    vi.advanceTimersByTime(1000);
    // Flush: sleep resolves → getQRCodeStatus("confirmed") → save token → return
    await flushPromises();

    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(result.botToken).toBe("bot-token-retry");
  });
});

// ---------------------------------------------------------------------------
// Test: Session restore
// ---------------------------------------------------------------------------

describe("AuthFlow.restoreSession", () => {
  let mockClient: iLinkClient;
  let tokenPath: string;

  beforeEach(() => {
    mockClient = createMockClient();
    tokenPath = tempTokenPath();
  });

  afterEach(async () => {
    try {
      await fs.unlink(tokenPath);
    } catch {
      // ignore
    }
  });

  it("should restore session from saved token file", async () => {
    // Write a valid token file
    const tokenData = { bot_token: "saved-token-123", base_url: "https://saved.example.com" };
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, JSON.stringify(tokenData), "utf-8");

    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    const result = await authFlow.restoreSession();

    expect(result.success).toBe(true);
    expect(result.botToken).toBe("saved-token-123");
    expect(result.baseUrl).toBe("https://saved.example.com");
    expect(authFlow.getState()).toBe("confirmed");
  });

  it("should return error when token file does not exist", async () => {
    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    const result = await authFlow.restoreSession();

    expect(result.success).toBe(false);
    expect(result.error).toContain("No saved session");
  });

  it("should return error when token file is empty", async () => {
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, "", "utf-8");

    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    const result = await authFlow.restoreSession();

    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("should return error when token file is missing required fields", async () => {
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, JSON.stringify({ bot_token: "only-token" }), "utf-8");

    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    const result = await authFlow.restoreSession();

    expect(result.success).toBe(false);
    expect(result.error).toContain("missing required fields");
  });
});

// ---------------------------------------------------------------------------
// Test: isAuthenticated
// ---------------------------------------------------------------------------

describe("AuthFlow.isAuthenticated", () => {
  let mockClient: iLinkClient;
  let tokenPath: string;

  beforeEach(() => {
    mockClient = createMockClient();
    tokenPath = tempTokenPath();
  });

  afterEach(async () => {
    try {
      await fs.unlink(tokenPath);
    } catch {
      // ignore
    }
  });

  it("should return false when token file does not exist", () => {
    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    expect(authFlow.isAuthenticated()).toBe(false);
  });

  it("should return true when valid token file exists", async () => {
    const tokenData = { bot_token: "valid-token", base_url: "https://valid.example.com" };
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, JSON.stringify(tokenData), "utf-8");

    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    expect(authFlow.isAuthenticated()).toBe(true);
  });

  it("should return false when token file is empty", async () => {
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, "", "utf-8");

    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    expect(authFlow.isAuthenticated()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test: logout
// ---------------------------------------------------------------------------

describe("AuthFlow.logout", () => {
  let mockClient: iLinkClient;
  let tokenPath: string;

  beforeEach(() => {
    mockClient = createMockClient();
    tokenPath = tempTokenPath();
  });

  afterEach(async () => {
    try {
      await fs.unlink(tokenPath);
    } catch {
      // ignore
    }
  });

  it("should delete token file and reset state", async () => {
    const tokenData = { bot_token: "to-delete", base_url: "https://delete.example.com" };
    await fs.mkdir(path.dirname(tokenPath), { recursive: true });
    await fs.writeFile(tokenPath, JSON.stringify(tokenData), "utf-8");

    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    expect(authFlow.isAuthenticated()).toBe(true);

    await authFlow.logout();

    expect(authFlow.isAuthenticated()).toBe(false);
    expect(authFlow.getState()).toBe("unauthenticated");
  });

  it("should not throw when token file does not exist", async () => {
    const authFlow = new AuthFlow(mockClient, { botTokenPath: tokenPath });
    await expect(authFlow.logout()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test: QR code display pluggability
// ---------------------------------------------------------------------------

describe("AuthFlow QR code display", () => {
  let mockClient: iLinkClient;
  let tokenPath: string;

  beforeEach(() => {
    mockClient = createMockClient();
    tokenPath = tempTokenPath();
    vi.useFakeTimers();
  });

  afterEach(async () => {
    vi.useRealTimers();
    try {
      await fs.unlink(tokenPath);
    } catch {
      // ignore
    }
  });

  it("should use custom QR code displayer when provided", async () => {
    (mockClient.getBotQRCode as ReturnType<typeof vi.fn>).mockResolvedValue(mockQRResponse);
    const statusConfirmed: iLinkQRCodeStatusResponse = {
      status: "confirmed",
      bot_token: "custom-disp-token",
      baseurl: "https://custom.example.com",
    };
    (mockClient.getQRCodeStatus as ReturnType<typeof vi.fn>).mockResolvedValue(statusConfirmed);

    const displayed: Array<{ qrcode: string; qrcodeImgContent: string }> = [];
    const customDisplayer = (data: { qrcode: string; qrcodeImgContent: string }) => {
      displayed.push(data);
    };

    const authFlow = new AuthFlow(mockClient, {
      botTokenPath: tokenPath,
      pollIntervalMs: 1000,
      qrCodeDisplayer: customDisplayer,
    });

    const resultPromise = authFlow.login();

    // Flush: getBotQRCode resolves → display QR → enter while loop → getQRCodeStatus("confirmed") → save token → return
    await flushPromises();

    // No need to advance timers since getQRCodeStatus resolves immediately with "confirmed"
    const result = await resultPromise;

    expect(displayed).toHaveLength(1);
    expect(displayed[0].qrcode).toBe("qr-code-123");
    expect(displayed[0].qrcodeImgContent).toBe("base64-image-data");
    expect(result.success).toBe(true);
  });
});