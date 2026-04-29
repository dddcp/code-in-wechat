import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  iLinkClient,
  iLinkError,
  SessionExpiredError,
  NetworkError,
  WeChatItemType,
} from "../../src/wechat";
import type {
  iLinkConfig,
  iLinkGetUpdatesResponse,
  iLinkQRCodeResponse,
  iLinkQRCodeStatusResponse,
  iLinkGetConfigResponse,
  iLinkGetUploadUrlResponse,
} from "../../src/wechat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CONFIG: iLinkConfig = {
  base_url: "https://ilinkai.weixin.qq.com",
  bot_token: "test-bot-token-123",
};

const originalFetch = globalThis.fetch;

function mockFetch(body: unknown, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
  }) as unknown as typeof fetch;
}

function mockFetchImplementation(impl: (url: string, opts: RequestInit) => Promise<unknown>): void {
  globalThis.fetch = vi.fn().mockImplementation((url: string, opts: RequestInit) => {
    return impl(url, opts);
  }) as unknown as typeof fetch;
}

function mockFetchError(error: Error): void {
  globalThis.fetch = vi.fn().mockRejectedValue(error) as unknown as typeof fetch;
}

function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("iLinkClient", () => {
  let client: iLinkClient;

  beforeEach(() => {
    client = new iLinkClient(TEST_CONFIG);
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    restoreFetch();
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // X-WECHAT-UIN generation
  // -----------------------------------------------------------------------

  describe("generateXWechatUin (via request headers)", () => {
    it("should generate a valid base64-encoded random uint32 string", async () => {
      const capturedHeaders: Record<string, string>[] = [];
      mockFetchImplementation((_url, opts) => {
        capturedHeaders.push(opts.headers as Record<string, string>);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ret: 0, qrcode: "test", qrcode_img_content: "img" }),
        });
      });

      await client.getBotQRCode();

      expect(capturedHeaders.length).toBe(1);
      const uin = capturedHeaders[0]["X-WECHAT-UIN"];
      // Decode base64 → should be a decimal string of a uint32
      const decoded = atob(uin);
      const num = parseInt(decoded, 10);
      expect(num).toBeGreaterThanOrEqual(0);
      expect(num).toBeLessThanOrEqual(4294967295);
    });

    it("should generate different X-WECHAT-UIN values on each call", async () => {
      const capturedHeaders: string[] = [];
      mockFetchImplementation((_url, opts) => {
        capturedHeaders.push((opts.headers as Record<string, string>)["X-WECHAT-UIN"]);
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ ret: 0, qrcode: "test", qrcode_img_content: "img" }),
        });
      });

      await client.getBotQRCode();
      await client.getBotQRCode();

      // Extremely unlikely to be equal (1 in 4 billion)
      expect(capturedHeaders[0]).not.toBe(capturedHeaders[1]);
    });
  });

  // -----------------------------------------------------------------------
  // Auth headers
  // -----------------------------------------------------------------------

  it("should include correct auth headers in every request", async () => {
    const capturedHeaders: Record<string, string>[] = [];
    mockFetchImplementation((_url, opts) => {
      capturedHeaders.push(opts.headers as Record<string, string>);
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ret: 0, qrcode: "test", qrcode_img_content: "img" }),
      });
    });

    await client.getBotQRCode();

    expect(capturedHeaders[0]["AuthorizationType"]).toBe("ilink_bot_token");
    expect(capturedHeaders[0]["Authorization"]).toBe("Bearer test-bot-token-123");
    expect(capturedHeaders[0]["Content-Type"]).toBe("application/json");
    expect(capturedHeaders[0]["X-WECHAT-UIN"]).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // getBotQRCode
  // -----------------------------------------------------------------------

  describe("getBotQRCode", () => {
    it("should call GET /ilink/bot/get_bot_qrcode?bot_type=3 and return QR code data", async () => {
      const mockResponse: iLinkQRCodeResponse = {
        qrcode: "qr-code-value",
        qrcode_img_content: "base64-img-data",
      };
      mockFetch({ ret: 0, ...mockResponse });

      const result = await client.getBotQRCode();

      expect(result.qrcode).toBe("qr-code-value");
      expect(result.qrcode_img_content).toBe("base64-img-data");
      expect(fetch).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
        expect.objectContaining({ method: "GET" }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // getQRCodeStatus
  // -----------------------------------------------------------------------

  describe("getQRCodeStatus", () => {
    it("should call GET /ilink/bot/get_qrcode_status with encoded qrcode param", async () => {
      const mockResponse: iLinkQRCodeStatusResponse = {
        status: "confirmed",
        bot_token: "new-token",
        baseurl: "https://ilinkai.weixin.qq.com",
      };
      mockFetch({ ret: 0, ...mockResponse });

      const result = await client.getQRCodeStatus("qr=test&val=1");

      expect(result.status).toBe("confirmed");
      expect(result.bot_token).toBe("new-token");
      expect(fetch).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/ilink/bot/get_qrcode_status?qrcode=qr%3Dtest%26val%3D1",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should handle 'wait' status", async () => {
      mockFetch({ ret: 0, status: "wait" });

      const result = await client.getQRCodeStatus("abc");
      expect(result.status).toBe("wait");
    });

    it("should handle 'scaned' status", async () => {
      mockFetch({ ret: 0, status: "scaned" });

      const result = await client.getQRCodeStatus("abc");
      expect(result.status).toBe("scaned");
    });
  });

  // -----------------------------------------------------------------------
  // getUpdates
  // -----------------------------------------------------------------------

  describe("getUpdates", () => {
    it("should call POST /ilink/bot/getupdates with correct body", async () => {
      const mockResponse: iLinkGetUpdatesResponse = {
        ret: 0,
        msgs: [],
        get_updates_buf: "new-cursor-123",
        longpolling_timeout_ms: 30000,
      };
      mockFetch(mockResponse);

      const result = await client.getUpdates("old-cursor");

      expect(result.get_updates_buf).toBe("new-cursor-123");
      expect(result.msgs).toEqual([]);
      expect(fetch).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/ilink/bot/getupdates",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            get_updates_buf: "old-cursor",
            base_info: { channel_version: "1.0.0" },
          }),
        }),
      );
    });

    it("should return messages from getUpdates response", async () => {
      const mockResponse: iLinkGetUpdatesResponse = {
        ret: 0,
        msgs: [
          {
            from_user_id: "user1",
            to_user_id: "bot1",
            message_type: 1,
            message_state: 0,
            context_token: "ctx-token",
            item_list: [{ type: WeChatItemType.Text, text: "Hello" }],
          },
        ],
        get_updates_buf: "cursor-2",
        longpolling_timeout_ms: 30000,
      };
      mockFetch(mockResponse);

      const result = await client.getUpdates("cursor-1");

      expect(result.msgs).toHaveLength(1);
      expect(result.msgs[0].from_user_id).toBe("user1");
      expect(result.msgs[0].item_list[0].type).toBe(WeChatItemType.Text);
    });
  });

  // -----------------------------------------------------------------------
  // sendMessage
  // -----------------------------------------------------------------------

  describe("sendMessage", () => {
    it("should call POST /ilink/bot/sendmessage with message payload", async () => {
      mockFetch({ ret: 0 });

      const params = {
        msg: {
          from_user_id: "bot1",
          to_user_id: "user1",
          client_id: "client-1",
          message_type: 2,
          message_state: 2,
          context_token: "ctx-token",
          item_list: [{ type: WeChatItemType.Text, text: "Reply" }],
        },
        base_info: { channel_version: "1.0.0" as const },
      };

      await client.sendMessage(params);

      expect(fetch).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/ilink/bot/sendmessage",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(params),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // sendTyping
  // -----------------------------------------------------------------------

  describe("sendTyping", () => {
    it("should call POST /ilink/bot/sendtyping with typing payload", async () => {
      mockFetch({ ret: 0 });

      const params = {
        ilink_user_id: "user1",
        typing_ticket: "ticket-abc",
        status: 1,
        base_info: { channel_version: "1.0.0" as const },
      };

      await client.sendTyping(params);

      expect(fetch).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/ilink/bot/sendtyping",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(params),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // getConfig
  // -----------------------------------------------------------------------

  describe("getConfig", () => {
    it("should call POST /ilink/bot/getconfig and return typing_ticket", async () => {
      const mockResponse: iLinkGetConfigResponse = { typing_ticket: "ticket-xyz" };
      mockFetch({ ret: 0, ...mockResponse });

      const params = {
        ilink_user_id: "user1",
        context_token: "ctx-token",
        base_info: { channel_version: "1.0.0" as const },
      };

      const result = await client.getConfig(params);

      expect(result.typing_ticket).toBe("ticket-xyz");
      expect(fetch).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/ilink/bot/getconfig",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(params),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // getUploadUrl
  // -----------------------------------------------------------------------

  describe("getUploadUrl", () => {
    it("should call POST /ilink/bot/getuploadurl and return URLs", async () => {
      const mockResponse: iLinkGetUploadUrlResponse = {
        upload_url: "https://cdn.example.com/upload",
        download_url: "https://cdn.example.com/download/file",
      };
      mockFetch({ ret: 0, ...mockResponse });

      const params = {
        file_type: 2,
        file_size: 1024,
        aes_key: "base64key==",
        base_info: { channel_version: "1.0.0" as const },
      };

      const result = await client.getUploadUrl(params);

      expect(result.upload_url).toBe("https://cdn.example.com/upload");
      expect(result.download_url).toBe("https://cdn.example.com/download/file");
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("should throw SessionExpiredError when ret=-14", async () => {
      mockFetch({ ret: -14, msg: "session expired" });

      await expect(client.getUpdates("cursor")).rejects.toThrow(SessionExpiredError);
      await expect(client.getUpdates("cursor")).rejects.toThrow("Session expired");
    });

    it("should throw iLinkError for other non-zero ret codes", async () => {
      mockFetch({ ret: -1, msg: "unknown error" });

      await expect(client.getUpdates("cursor")).rejects.toThrow(iLinkError);
      try {
        await client.getUpdates("cursor");
      } catch (e) {
        expect(e).toBeInstanceOf(iLinkError);
        const err = e as iLinkError;
        expect(err.ret).toBe(-1);
        expect(err.message).toContain("unknown error");
      }
    });

    it("should throw NetworkError on fetch failure", async () => {
      mockFetchError(new Error("Connection refused"));

      await expect(client.getUpdates("cursor")).rejects.toThrow(NetworkError);
      await expect(client.getUpdates("cursor")).rejects.toThrow("Connection refused");
    });

    it("should throw NetworkError on non-200 HTTP status", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: () => Promise.resolve({ error: "server error" }),
      }) as unknown as typeof fetch;

      await expect(client.getUpdates("cursor")).rejects.toThrow(NetworkError);
    });

    it("SessionExpiredError should be an instance of iLinkError", () => {
      const err = new SessionExpiredError();
      expect(err).toBeInstanceOf(iLinkError);
      expect(err).toBeInstanceOf(Error);
      expect(err.ret).toBe(-14);
      expect(err.name).toBe("SessionExpiredError");
    });

    it("NetworkError should preserve original cause", () => {
      const cause = new Error("DNS lookup failed");
      const err = new NetworkError(cause);
      expect(err.cause).toBe(cause);
      expect(err.message).toContain("DNS lookup failed");
      expect(err.name).toBe("NetworkError");
    });
  });

  // -----------------------------------------------------------------------
  // Base URL normalization
  // -----------------------------------------------------------------------

  describe("base URL normalization", () => {
    it("should strip trailing slashes from base_url", async () => {
      const clientWithSlash = new iLinkClient({
        base_url: "https://ilinkai.weixin.qq.com/",
        bot_token: "tok",
      });
      mockFetch({ ret: 0, qrcode: "qr", qrcode_img_content: "img" });

      await clientWithSlash.getBotQRCode();

      expect(fetch).toHaveBeenCalledWith(
        "https://ilinkai.weixin.qq.com/ilink/bot/get_bot_qrcode?bot_type=3",
        expect.anything(),
      );
    });
  });
});