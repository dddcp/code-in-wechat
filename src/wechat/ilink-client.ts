import type {
  iLinkConfig,
  iLinkGetUpdatesRequest,
  iLinkGetUpdatesResponse,
  iLinkSendMessageRequest,
  iLinkSendTypingRequest,
  iLinkGetConfigRequest,
  iLinkGetConfigResponse,
  iLinkGetUploadUrlRequest,
  iLinkGetUploadUrlResponse,
  iLinkQRCodeResponse,
  iLinkQRCodeStatusResponse,
} from "./types";
import { iLinkError, SessionExpiredError, NetworkError, RateLimitError, iLinkAPIError } from "./types";

/**
 * iLink HTTP API client for WeChat ClawBot communication.
 *
 * Uses native `fetch` — no external HTTP library.
 * Auth headers:
 *   AuthorizationType: ilink_bot_token
 *   Authorization: Bearer <token>
 *   X-WECHAT-UIN: <base64(randomUint32 decimal string)>
 */
export class iLinkClient {
  private readonly baseUrl: string;
  private readonly botToken: string;

  constructor(config: iLinkConfig) {
    this.baseUrl = config.base_url.replace(/\/+$/, "");
    this.botToken = config.bot_token;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Generate X-WECHAT-UIN header value.
   * Algorithm: random uint32 → decimal string → base64 encode
   */
  private generateXWechatUin(): string {
    const randomUint32 = Math.floor(Math.random() * 0x100000000); // 0 to 4294967295
    const decimalString = randomUint32.toString(10);
    return btoa(decimalString);
  }

  /**
   * Build auth headers common to all requests.
   */
  private buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      AuthorizationType: "ilink_bot_token",
      Authorization: `Bearer ${this.botToken}`,
      "X-WECHAT-UIN": this.generateXWechatUin(),
    };
  }

  /**
   * Core API request method.
   * Handles auth headers, JSON parsing, and error classification.
   */
  private async apiRequest<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers = this.buildHeaders();

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new NetworkError(
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    if (!response.ok) {
      // Some iLink endpoints return 200 even on logical errors (ret != 0).
      // Only throw NetworkError for genuine HTTP failures.
      if (response.status === 429) {
        throw new RateLimitError(
          response.status,
          `HTTP 429: ${response.statusText}`,
        );
      }
      throw new NetworkError(
        new Error(`HTTP ${response.status}: ${response.statusText}`),
      );
    }

    const json = (await response.json()) as Record<string, unknown>;

    // iLink API uses `ret` field to indicate success/error.
    // ret = 0 means success; ret = -14 means session expired; others are errors.
    if (typeof json.ret === "number" && json.ret !== 0) {
      if (json.ret === -14) {
        throw new SessionExpiredError();
      }
      throw new iLinkAPIError(
        json.ret,
        (json.msg as string) ?? (json.errmsg as string) ?? "Unknown error",
      );
    }

    return json as T;
  }

  // -----------------------------------------------------------------------
  // Public API methods
  // -----------------------------------------------------------------------

  /**
   * Get bot QR code for login.
   * GET /ilink/bot/get_bot_qrcode?bot_type=3
   */
  async getBotQRCode(): Promise<iLinkQRCodeResponse> {
    return this.apiRequest<iLinkQRCodeResponse>(
      "GET",
      "/ilink/bot/get_bot_qrcode?bot_type=3",
    );
  }

  /**
   * Get QR code login status.
   * GET /ilink/bot/get_qrcode_status?qrcode=<qrcode>
   */
  async getQRCodeStatus(qrcode: string): Promise<iLinkQRCodeStatusResponse> {
    const encoded = encodeURIComponent(qrcode);
    return this.apiRequest<iLinkQRCodeStatusResponse>(
      "GET",
      `/ilink/bot/get_qrcode_status?qrcode=${encoded}`,
    );
  }

  /**
   * Long-poll for new messages.
   * POST /ilink/bot/getupdates
   */
  async getUpdates(buf: string): Promise<iLinkGetUpdatesResponse> {
    const body: iLinkGetUpdatesRequest = {
      get_updates_buf: buf,
      base_info: { channel_version: "1.0.0" },
    };
    return this.apiRequest<iLinkGetUpdatesResponse>(
      "POST",
      "/ilink/bot/getupdates",
      body,
    );
  }

  /**
   * Send a message to a WeChat user.
   * POST /ilink/bot/sendmessage
   */
  async sendMessage(params: iLinkSendMessageRequest): Promise<void> {
    console.log("[ilink] sendMessage request body:", JSON.stringify(params, null, 2));
    const result = await this.apiRequest<Record<string, unknown>>("POST", "/ilink/bot/sendmessage", params);
    console.log("[ilink] sendMessage response:", JSON.stringify(result));
  }

  /**
   * Send typing status indicator.
   * POST /ilink/bot/sendtyping
   */
  async sendTyping(params: iLinkSendTypingRequest): Promise<void> {
    await this.apiRequest<void>("POST", "/ilink/bot/sendtyping", params);
  }

  /**
   * Get bot config including typing_ticket.
   * POST /ilink/bot/getconfig
   */
  async getConfig(
    params: iLinkGetConfigRequest,
  ): Promise<iLinkGetConfigResponse> {
    return this.apiRequest<iLinkGetConfigResponse>(
      "POST",
      "/ilink/bot/getconfig",
      params,
    );
  }

  /**
   * Get CDN upload URL for media files.
   * POST /ilink/bot/getuploadurl
   */
  async getUploadUrl(
    params: iLinkGetUploadUrlRequest,
  ): Promise<iLinkGetUploadUrlResponse> {
    return this.apiRequest<iLinkGetUploadUrlResponse>(
      "POST",
      "/ilink/bot/getuploadurl",
      params,
    );
  }
}