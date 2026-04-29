import type { ToolSession, ToolResponse, StreamChunk, ToolMessagePart } from '@/types/tool';

/**
 * Abstract interface for interacting with AI coding tools.
 * Implementations wrap specific tool SDKs (OpenCode, Claude Code, etc.)
 * and provide a unified API for the WeChat bridge.
 */
export interface ToolAdapter {
  /** Human-readable adapter name */
  readonly name: string;

  /** Initialize the adapter (start server, establish connections, etc.) */
  initialize(): Promise<void>;

  /** Create a new session */
  createSession(title?: string): Promise<ToolSession>;

  /** Send a message to a session and wait for the complete response */
  sendMessage(sessionId: string, content: string, parts?: ToolMessagePart[]): Promise<ToolResponse>;

  /** Stream response chunks from a session (resolves when session becomes idle) */
  streamResponse(sessionId: string, onChunk: (chunk: StreamChunk) => void): Promise<void>;

  /** Send a message and stream the response in real-time (subscribe events, then prompt) */
  sendAndStream(
    sessionId: string,
    content: string,
    parts: ToolMessagePart[] | undefined,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void>;

  /** Abort an in-progress session */
  abortSession(sessionId: string): Promise<void>;

  /** Get information about a session */
  getSessionInfo(sessionId: string): Promise<ToolSession>;

  /** Clean up resources (close server, etc.) */
  dispose(): Promise<void>;
}