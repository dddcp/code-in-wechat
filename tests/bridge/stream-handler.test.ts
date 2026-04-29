import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chunkText, StreamHandler } from "../../src/bridge/stream-handler";
import type { iLinkClient } from "../../src/wechat/ilink-client";
import type { BridgeStreamChunk } from "../../src/types/bridge";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a mock iLinkClient with all methods stubbed */
function createMockClient(): iLinkClient {
  return {
    getConfig: vi.fn().mockResolvedValue({ typing_ticket: "ticket-123" }),
    sendTyping: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    getUpdates: vi.fn(),
    getBotQRCode: vi.fn(),
    getQRCodeStatus: vi.fn(),
    getUploadUrl: vi.fn(),
  } as unknown as iLinkClient;
}

/** Create an async iterable from an array of BridgeStreamChunks */
async function* createStream(
  chunks: BridgeStreamChunk[],
): AsyncGenerator<BridgeStreamChunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

/** Generate a string of a given number of Unicode characters */
function repeatChar(char: string, count: number): string {
  return char.repeat(count);
}

// ---------------------------------------------------------------------------
// chunkText tests
// ---------------------------------------------------------------------------

describe("chunkText", () => {
  it("should return empty array for empty string", () => {
    expect(chunkText("")).toEqual([]);
  });

  it("should return single chunk for short string (< 2000 chars)", () => {
    const text = "Hello, world!";
    const result = chunkText(text);
    expect(result).toEqual(["Hello, world!"]);
  });

  it("should return single chunk for exactly 2000 characters", () => {
    const text = repeatChar("A", 2000);
    const result = chunkText(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(2000);
  });

  it("should split long string into multiple chunks", () => {
    const text = repeatChar("A", 5000);
    const result = chunkText(text);
    expect(result).toHaveLength(3);
    expect(result[0]).toHaveLength(2000);
    expect(result[1]).toHaveLength(2000);
    expect(result[2]).toHaveLength(1000);
  });

  it("should respect Unicode boundaries — surrogate pairs not split", () => {
    // 🎉 is U+1F389, a single code point that's 2 UTF-16 code units.
    // Array.from() correctly keeps it as one element (no surrogate split).
    const emoji = "🎉";
    const text = emoji.repeat(5); // 5 emoji = 5 Array.from elements
    const result = chunkText(text, 3);
    expect(result).toHaveLength(2);
    expect(Array.from(result[0]).length).toBe(3); // 3 emoji
    expect(Array.from(result[1]).length).toBe(2); // 2 emoji
  });

  it("should not split CJK characters across chunks", () => {
    const text = "你好世界你好世界你好世界";
    const chars = Array.from(text);
    const result = chunkText(text, 4);
    // Each chunk should have at most 4 CJK characters
    for (const chunk of result) {
      expect(Array.from(chunk).length).toBeLessThanOrEqual(4);
    }
    // Concatenated chunks should equal original text
    expect(result.join("")).toBe(text);
  });

  it("should handle mixed CJK and emoji text correctly", () => {
    const text = "你好世界🎉🎊你好世界🎉🎊你好世界🎉🎊";
    const chars = Array.from(text);
    const result = chunkText(text, 5);
    expect(result).toHaveLength(Math.ceil(chars.length / 5));
    // Verify no chunk exceeds maxLen
    for (const chunk of result) {
      expect(Array.from(chunk).length).toBeLessThanOrEqual(5);
    }
  });

  it("should return single chunk for a single character", () => {
    expect(chunkText("A")).toEqual(["A"]);
  });

  it("should use custom maxLen when provided", () => {
    const text = "ABCDEFGHIJ";
    const result = chunkText(text, 3);
    expect(result).toEqual(["ABC", "DEF", "GHI", "J"]);
  });
});

// ---------------------------------------------------------------------------
// StreamHandler.handleStream tests
// ---------------------------------------------------------------------------

describe("StreamHandler.handleStream", () => {
  let mockClient: iLinkClient;

  beforeEach(() => {
    mockClient = createMockClient();
  });

  it("should throw error when no stream provider is configured", async () => {
    const handler = new StreamHandler(mockClient);
    await expect(
      handler.handleStream("session-1", vi.fn()),
    ).rejects.toThrow("No stream provider configured");
  });

  it("should accumulate text and emit chunks at correct boundaries", async () => {
    const chunks: string[] = [];
    const streamChunks: BridgeStreamChunk[] = [
      { text: "Hello, ", is_final: false, session_id: "s1" },
      { text: "world!", is_final: true, session_id: "s1" },
    ];

    const handler = new StreamHandler(mockClient, {
      streamProvider: (_sid) => createStream(streamChunks),
    });

    const fullText = await handler.handleStream("s1", (chunk) =>
      chunks.push(chunk),
    );

    expect(fullText).toBe("Hello, world!");
    expect(chunks).toEqual(["Hello, world!"]);
  });

  it("should emit multiple chunks when text exceeds chunkSize", async () => {
    const emittedChunks: string[] = [];
    const longText = repeatChar("X", 3000);
    const streamChunks: BridgeStreamChunk[] = [
      { text: longText, is_final: true, session_id: "s1" },
    ];

    const handler = new StreamHandler(mockClient, {
      chunkSize: 2000,
      streamProvider: (_sid) => createStream(streamChunks),
    });

    const fullText = await handler.handleStream("s1", (chunk) =>
      emittedChunks.push(chunk),
    );

    expect(fullText).toBe(longText);
    expect(emittedChunks).toHaveLength(2);
    expect(emittedChunks[0]).toHaveLength(2000);
    expect(emittedChunks[1]).toHaveLength(1000);
  });

  it("should buffer text across multiple stream events before emitting", async () => {
    const emittedChunks: string[] = [];
    const streamChunks: BridgeStreamChunk[] = [
      { text: repeatChar("A", 1500), is_final: false, session_id: "s1" },
      { text: repeatChar("B", 1500), is_final: false, session_id: "s1" },
      { text: repeatChar("C", 500), is_final: true, session_id: "s1" },
    ];

    const handler = new StreamHandler(mockClient, {
      chunkSize: 2000,
      streamProvider: (_sid) => createStream(streamChunks),
    });

    const fullText = await handler.handleStream("s1", (chunk) =>
      emittedChunks.push(chunk),
    );

    expect(fullText).toHaveLength(3500);
    // First chunk: 2000 chars (1500 A + 500 B)
    expect(emittedChunks[0]).toHaveLength(2000);
    expect(emittedChunks[0].startsWith("A")).toBe(true);
    // Second chunk: remaining 1500 chars (1000 B + 500 C)
    expect(emittedChunks[1]).toHaveLength(1500);
  });

  it("should handle stream with no text content", async () => {
    const emittedChunks: string[] = [];
    const streamChunks: BridgeStreamChunk[] = [
      { text: "", is_final: false, session_id: "s1" },
      { text: "", is_final: true, session_id: "s1" },
    ];

    const handler = new StreamHandler(mockClient, {
      streamProvider: (_sid) => createStream(streamChunks),
    });

    const fullText = await handler.handleStream("s1", (chunk) =>
      emittedChunks.push(chunk),
    );

    expect(fullText).toBe("");
    expect(emittedChunks).toHaveLength(0);
  });

  it("should handle stream error mid-chunk", async () => {
    const emittedChunks: string[] = [];

    async function* failingStream(): AsyncGenerator<BridgeStreamChunk> {
      yield { text: "Partial data", is_final: false, session_id: "s1" };
      throw new Error("Stream connection lost");
    }

    const handler = new StreamHandler(mockClient, {
      streamProvider: (_sid) => failingStream(),
    });

    await expect(
      handler.handleStream("s1", (chunk) => emittedChunks.push(chunk)),
    ).rejects.toThrow("Stream connection lost");

    // Partial data should have been flushed before the error propagated
    expect(emittedChunks).toEqual(["Partial data"]);
  });

  it("should respect is_final flag to end stream early", async () => {
    const emittedChunks: string[] = [];
    const streamChunks: BridgeStreamChunk[] = [
      { text: "Done early", is_final: true, session_id: "s1" },
      // This chunk should never be reached
      { text: "Should not appear", is_final: false, session_id: "s1" },
    ];

    const handler = new StreamHandler(mockClient, {
      streamProvider: (_sid) => createStream(streamChunks),
    });

    const fullText = await handler.handleStream("s1", (chunk) =>
      emittedChunks.push(chunk),
    );

    expect(fullText).toBe("Done early");
    expect(emittedChunks).toEqual(["Done early"]);
  });
});

// ---------------------------------------------------------------------------
// StreamHandler typing management tests
// ---------------------------------------------------------------------------

describe("StreamHandler typing management", () => {
  let mockClient: iLinkClient;

  beforeEach(() => {
    mockClient = createMockClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should send typing start (status=1) and call getConfig on startTyping", async () => {
    const handler = new StreamHandler(mockClient);

    await handler.startTyping("user-1", "ctx-token-1");

    expect(mockClient.getConfig).toHaveBeenCalledWith({
      ilink_user_id: "user-1",
      context_token: "ctx-token-1",
      base_info: { channel_version: "1.0.0" },
    });

    expect(mockClient.sendTyping).toHaveBeenCalledWith({
      ilink_user_id: "user-1",
      typing_ticket: "ticket-123",
      status: 1,
      base_info: { channel_version: "1.0.0" },
    });
  });

  it("should send typing cancel (status=2) on stopTyping", async () => {
    const handler = new StreamHandler(mockClient);

    await handler.startTyping("user-1", "ctx-token-1");
    await handler.stopTyping("user-1", "ctx-token-1");

    // Last sendTyping call should be status=2
    const calls = (mockClient.sendTyping as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1][0];
    expect(lastCall.status).toBe(2);
    expect(lastCall.ilink_user_id).toBe("user-1");
    expect(lastCall.typing_ticket).toBe("ticket-123");
  });

  it("should send keepalive typing at 5-second intervals", async () => {
    const handler = new StreamHandler(mockClient, {
      typingKeepaliveMs: 5000,
    });

    await handler.startTyping("user-1", "ctx-token-1");

    // Initial call: getConfig + sendTyping(status=1)
    expect(mockClient.getConfig).toHaveBeenCalledTimes(1);
    expect(mockClient.sendTyping).toHaveBeenCalledTimes(1);

    // Advance 5 seconds — should trigger keepalive
    vi.advanceTimersByTime(5000);

    expect(mockClient.sendTyping).toHaveBeenCalledTimes(2);
    const keepaliveCall = (mockClient.sendTyping as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(keepaliveCall.status).toBe(1);

    // Advance another 5 seconds
    vi.advanceTimersByTime(5000);

    expect(mockClient.sendTyping).toHaveBeenCalledTimes(3);
  });

  it("should clear keepalive interval on stopTyping", async () => {
    const handler = new StreamHandler(mockClient, {
      typingKeepaliveMs: 5000,
    });

    await handler.startTyping("user-1", "ctx-token-1");
    await handler.stopTyping("user-1", "ctx-token-1");

    // Reset call count
    (mockClient.sendTyping as ReturnType<typeof vi.fn>).mockClear();

    // Advance 10 seconds — no more keepalive calls
    vi.advanceTimersByTime(10000);

    expect(mockClient.sendTyping).not.toHaveBeenCalled();
  });

  it("should handle stopTyping when no active typing session exists", async () => {
    const handler = new StreamHandler(mockClient);

    // Should not throw
    await handler.stopTyping("unknown-user", "ctx-token");

    // Should not call sendTyping
    expect(mockClient.sendTyping).not.toHaveBeenCalled();
  });

  it("should replace existing typing session when startTyping is called again", async () => {
    const handler = new StreamHandler(mockClient);

    await handler.startTyping("user-1", "ctx-token-1");
    // getConfig called once for first startTyping
    expect(mockClient.getConfig).toHaveBeenCalledTimes(1);

    // Start again — should stop previous session first
    await handler.startTyping("user-1", "ctx-token-2");

    // getConfig called again for the new session
    expect(mockClient.getConfig).toHaveBeenCalledTimes(2);

    // Should have sent: start(1), stop(2), start(1) = 3 sendTyping calls
    expect(mockClient.sendTyping).toHaveBeenCalledTimes(3);
  });

  it("should use custom typingKeepaliveMs when provided", async () => {
    const handler = new StreamHandler(mockClient, {
      typingKeepaliveMs: 3000,
    });

    await handler.startTyping("user-1", "ctx-token-1");

    // Initial call
    expect(mockClient.sendTyping).toHaveBeenCalledTimes(1);

    // Advance 3 seconds — should trigger keepalive
    vi.advanceTimersByTime(3000);

    expect(mockClient.sendTyping).toHaveBeenCalledTimes(2);
  });

  it("should tolerate keepalive errors without stopping the interval", async () => {
    const handler = new StreamHandler(mockClient, {
      typingKeepaliveMs: 5000,
    });

    await handler.startTyping("user-1", "ctx-token-1");

    // Make the next sendTyping call fail
    (mockClient.sendTyping as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("Network error"));

    // Advance 5 seconds — keepalive should fail silently
    vi.advanceTimersByTime(5000);

    // Advance another 5 seconds — keepalive should still fire
    vi.advanceTimersByTime(5000);

    // Should have: initial + failed keepalive + successful keepalive
    // At least 3 sendTyping calls total
    const callCount = mockClient.sendTyping.mock.calls.length;
    expect(callCount).toBeGreaterThanOrEqual(3);
  });
});