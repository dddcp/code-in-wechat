/**
 * Core types for the ToolAdapter interface.
 * These types abstract away tool-specific details and provide
 * a unified interface for interacting with AI coding tools.
 */

// ---------------------------------------------------------------------------
// Enums (legacy, kept for backward compatibility)
// ---------------------------------------------------------------------------

export enum ToolMessageRole {
  USER = 'user',
  ASSISTANT = 'assistant',
}

export enum ToolMessagePartType {
  TEXT = 'text',
  FILE = 'file',
  IMAGE = 'image',
}

// ---------------------------------------------------------------------------
// Legacy message types (for ToolMessage-based API)
// ---------------------------------------------------------------------------

export interface ToolMessage {
  role: ToolMessageRole;
  content: string;
  parts: ToolMessagePartLegacy[];
}

export interface ToolMessagePartLegacy {
  type: ToolMessagePartType;
  text?: string;
  file_url?: string;
  image_url?: string;
}

// ---------------------------------------------------------------------------
// Modern adapter types
// ---------------------------------------------------------------------------

/** Status of a tool session */
export type ToolSessionStatus = 'idle' | 'busy' | 'retry' | 'error';

/** A session managed by a tool adapter */
export interface ToolSession {
  /** Unique session identifier */
  id: string;
  /** Session title (optional) */
  title?: string;
  /** Current session status */
  status: ToolSessionStatus;
  /** Timestamp when session was created (epoch ms) */
  createdAt: number;
  /** Timestamp when session was last updated (epoch ms) */
  updatedAt: number;
}

/** A text content part of a message */
export interface TextMessagePart {
  type: 'text';
  text: string;
}

/** A file content part of a message */
export interface FileMessagePart {
  type: 'file';
  mime: string;
  url: string;
  filename?: string;
}

/** Union of message part types */
export type ToolMessagePart = TextMessagePart | FileMessagePart;

/** Response from sending a message to a tool */
export interface ToolResponse {
  /** The message ID from the tool */
  id: string;
  /** The session ID this message belongs to */
  sessionId: string;
  /** Text content of the response */
  text: string;
  /** Full response parts (if available) */
  parts: ToolMessagePart[];
  /** Token usage info (if available) */
  tokens?: {
    input: number;
    output: number;
  };
}

/** A chunk of streamed response data */
export interface StreamChunk {
  /** Type of the chunk */
  type: 'text' | 'tool_start' | 'tool_end' | 'error' | 'done';
  /** Text content (for text chunks) */
  text?: string;
  /** Tool name (for tool_start/tool_end chunks) */
  toolName?: string;
  /** Error message (for error chunks) */
  error?: string;
}

/** Error thrown by tool adapters */
export class ToolAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ToolAdapterError';
  }
}

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

  /** Abort an in-progress session */
  abortSession(sessionId: string): Promise<void>;

  /** Get information about a session */
  getSessionInfo(sessionId: string): Promise<ToolSession>;

  /** Clean up resources (close server, etc.) */
  dispose(): Promise<void>;
}