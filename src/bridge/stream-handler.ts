/**
 * Stream Handler for processing SSE events from OpenCode
 * and chunking them for WeChat sending.
 *
 * Key responsibilities:
 * - Chunk text into ≤2000 Unicode character segments (respecting emoji/CJK boundaries)
 * - Manage iLink typing indicators (start/stop/keepalive)
 * - Process SSE stream events and emit chunks via callback
 */

import type { iLinkClient } from "@/wechat/ilink-client";
import type { BridgeStreamChunk } from "@/types/bridge";
import { createLogger } from "@/log";

const logger = createLogger("stream");

// ---------------------------------------------------------------------------
// chunkText - Pure function for Unicode-safe text chunking
// ---------------------------------------------------------------------------

/**
 * Split text into chunks of at most `maxLen` Unicode characters.
 * Uses `Array.from()` to properly handle surrogate pairs and emoji sequences.
 *
 * @param text   The text to chunk
 * @param maxLen Maximum characters per chunk (default 2000, WeChat limit)
 * @returns Array of chunks, or empty array for empty input
 */
export function chunkText(text: string, maxLen: number = 2000): string[] {
  if (text.length === 0) return [];

  const chars = Array.from(text);
  const chunks: string[] = [];

  for (let i = 0; i < chars.length; i += maxLen) {
    chunks.push(chars.slice(i, i + maxLen).join(""));
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// StreamHandler options & typing state
// ---------------------------------------------------------------------------

/** Function that provides an async iterable of stream chunks for a session */
export type StreamProvider = (
  sessionId: string,
) => AsyncIterable<BridgeStreamChunk>;

export interface StreamHandlerOptions {
  /** Maximum characters per chunk (default: 2000) */
  chunkSize?: number;
  /** Interval in ms between typing keepalive signals (default: 5000) */
  typingKeepaliveMs?: number;
  /** Factory function that returns an async iterable of stream chunks */
  streamProvider?: StreamProvider;
}

interface TypingState {
  intervalId: ReturnType<typeof setInterval>;
  typingTicket: string;
}

// ---------------------------------------------------------------------------
// StreamHandler class
// ---------------------------------------------------------------------------

/**
 * Processes SSE stream events from OpenCode, chunks text for WeChat sending,
 * and manages iLink typing indicators.
 */
export class StreamHandler {
  private readonly client: iLinkClient;
  private readonly chunkSize: number;
  private readonly typingKeepaliveMs: number;
  private readonly streamProvider?: StreamProvider;
  private readonly typingStates: Map<string, TypingState> = new Map();

  constructor(client: iLinkClient, options?: StreamHandlerOptions) {
    this.client = client;
    this.chunkSize = options?.chunkSize ?? 2000;
    this.typingKeepaliveMs = options?.typingKeepaliveMs ?? 5000;
    this.streamProvider = options?.streamProvider;
  }

  // -----------------------------------------------------------------------
  // Stream handling
  // -----------------------------------------------------------------------

  /**
   * Process an SSE stream from OpenCode, accumulate text, and emit chunks
   * via the onChunk callback when the accumulated text reaches chunkSize.
   *
   * @param sessionId The OpenCode session ID
   * @param onChunk   Callback invoked with each chunk of text
   * @returns         The full accumulated text when the stream completes
   * @throws          Error if no streamProvider is configured
   */
  async handleStream(
    sessionId: string,
    onChunk: (chunk: string) => void,
  ): Promise<string> {
    if (!this.streamProvider) {
      throw new Error("No stream provider configured");
    }

    const stream = this.streamProvider(sessionId);
    let fullText = "";
    let bufferChars: string[] = [];

    try {
      for await (const event of stream) {
        if (event.text) {
          const newChars = Array.from(event.text);
          bufferChars.push(...newChars);
          fullText += event.text;

          // Emit chunks when buffer exceeds chunkSize
          while (bufferChars.length >= this.chunkSize) {
            const chunk = bufferChars.slice(0, this.chunkSize).join("");
            bufferChars = bufferChars.slice(this.chunkSize);
            onChunk(chunk);
          }
        }

        if (event.is_final) {
          break;
        }
      }
    } catch {
      // Flush any buffered data before re-throwing
      if (bufferChars.length > 0) {
        onChunk(bufferChars.join(""));
      }
      throw new Error("Stream connection lost");
    }

    // Flush remaining buffer
    if (bufferChars.length > 0) {
      onChunk(bufferChars.join(""));
    }

    return fullText;
  }

  // -----------------------------------------------------------------------
  // Typing indicator management
  // -----------------------------------------------------------------------

  /**
   * Start sending typing indicator for a user.
   * Sends an initial status=1, then sets up a keepalive interval.
   *
   * @param userId        The iLink user ID
   * @param contextToken  The context token (used to obtain typing_ticket via getConfig)
   */
  async startTyping(userId: string, contextToken: string): Promise<void> {
    logger.debug("Starting typing indicator", { userId });
    // Stop any existing typing session for this user
    if (this.typingStates.has(userId)) {
      await this.stopTyping(userId, contextToken);
    }

    // Obtain typing_ticket via getConfig
    const config = await this.client.getConfig({
      ilink_user_id: userId,
      context_token: contextToken,
      base_info: { channel_version: "1.0.0" },
    });

    const typingTicket = config.typing_ticket;

    // Send initial typing start (status=1)
    await this.client.sendTyping({
      ilink_user_id: userId,
      typing_ticket: typingTicket,
      status: 1,
      base_info: { channel_version: "1.0.0" },
    });

    // Set up keepalive interval
    const intervalId = setInterval(async () => {
      try {
        await this.client.sendTyping({
          ilink_user_id: userId,
          typing_ticket: typingTicket,
          status: 1,
          base_info: { channel_version: "1.0.0" },
        });
      } catch {
        // Ignore keepalive errors — the next successful call will recover
      }
    }, this.typingKeepaliveMs);

    this.typingStates.set(userId, { intervalId, typingTicket });
  }

  /**
   * Stop sending typing indicator for a user.
   * Sends status=2 (cancel) and clears the keepalive interval.
   *
   * @param userId        The iLink user ID
   * @param contextToken  The context token (unused but kept for API consistency)
   */
  async stopTyping(userId: string, contextToken: string): Promise<void> {
    logger.debug("Stopping typing indicator", { userId });
    const state = this.typingStates.get(userId);
    if (!state) return;

    // Clear keepalive interval
    clearInterval(state.intervalId);
    this.typingStates.delete(userId);

    // Send typing cancel (status=2)
    await this.client.sendTyping({
      ilink_user_id: userId,
      typing_ticket: state.typingTicket,
      status: 2,
      base_info: { channel_version: "1.0.0" },
    });
  }
}