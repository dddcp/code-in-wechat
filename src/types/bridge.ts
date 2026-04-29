/**
 * Bridge event types
 * Used for communication between WeChat and tool adapters.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum BridgeEventType {
  MESSAGE = 'message',
  COMMAND = 'command',
  MEDIA = 'media',
}

// ---------------------------------------------------------------------------
// Core bridge types
// ---------------------------------------------------------------------------

export interface BridgeEvent {
  type: BridgeEventType;
  payload: unknown;
  source: string;
  timestamp: number;
}

export interface SlashCommand {
  name: string;
  args: string[];
  raw_text: string;
}

export interface BridgeStreamChunk {
  text: string;
  is_final: boolean;
  session_id: string;
}

/** @deprecated Use StreamChunk from tool.ts instead */
export type StreamChunk = BridgeStreamChunk;

// ---------------------------------------------------------------------------
// Command context & result
// ---------------------------------------------------------------------------

export interface CommandContext {
  sessionId: string;
  currentTool: string;
  sessionManager: unknown;
  toolAdapters: unknown;
}

export interface CommandResult {
  success: boolean;
  message: string;
  newState?: unknown;
}
