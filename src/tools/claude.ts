/**
 * Claude Adapter — ToolAdapter implementation for Anthropic Claude API.
 *
 * Reads configuration from ~/.claude/settings.json (or CLAUDE_SETTINGS_PATH).
 * Manages conversation history in memory (no persistence).
 * Uses @anthropic-ai/sdk for streaming responses.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { ToolAdapter } from './adapter';
import type {
  ToolSession,
  ToolResponse,
  StreamChunk,
  ToolMessagePart,
} from '@/types/tool';
import { createLogger } from "@/log";
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { expandTilde } from "@/utils/path";

const logger = createLogger("claude");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Claude adapter */
export interface ClaudeConfig {
  /** Path to Claude settings.json (default: ~/.claude/settings.json) */
  settingsPath: string;
  /** Working directory for the Claude session */
  workspaceDir?: string;
}

/** Parsed settings from ~/.claude/settings.json */
interface ClaudeSettings {
  env?: {
    ANTHROPIC_BASE_URL?: string;
    ANTHROPIC_AUTH_TOKEN?: string;
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_MODEL?: string;
    ANTHROPIC_DEFAULT_OPUS_MODEL?: string;
    ANTHROPIC_DEFAULT_SONNET_MODEL?: string;
    ANTHROPIC_DEFAULT_HAIKU_MODEL?: string;
  };
}

/** In-memory session with message history */
interface ClaudeSession {
  id: string;
  messages: Anthropic.MessageParam[];
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ClaudeConfigError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`Claude config error: ${message}`, options);
    this.name = "ClaudeConfigError";
  }
}

export class ClaudeSessionError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`Claude session error: ${message}`, options);
    this.name = "ClaudeSessionError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve model name with priority fallback.
 */
function resolveModel(settings: ClaudeSettings): string {
  const env = settings.env ?? {};
  return (
    env.ANTHROPIC_MODEL ??
    env.ANTHROPIC_DEFAULT_OPUS_MODEL ??
    env.ANTHROPIC_DEFAULT_SONNET_MODEL ??
    env.ANTHROPIC_DEFAULT_HAIKU_MODEL ??
    "claude-sonnet-4-6"
  );
}

/**
 * Generate a unique session ID.
 */
function generateSessionId(): string {
  return `claude-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// ClaudeAdapter
// ---------------------------------------------------------------------------

/**
 * Claude API implementation of the ToolAdapter interface.
 * Uses @anthropic-ai/sdk to communicate directly with Anthropic API.
 */
export class ClaudeAdapter implements ToolAdapter {
  readonly name = 'claude';

  private client: Anthropic | null = null;
  private model: string | null = null;
  private systemPrompt: string | null = null;
  private initialized = false;
  private readonly config: ClaudeConfig;

  /** In-memory session storage */
  private readonly sessions: Map<string, ClaudeSession> = new Map();

  constructor(config: ClaudeConfig) {
    this.config = config;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info("Initializing Claude adapter", { settingsPath: this.config.settingsPath });

    // Expand tilde in path
    const settingsPath = expandTilde(this.config.settingsPath);

    // Check if settings file exists
    if (!existsSync(settingsPath)) {
      throw new ClaudeConfigError(
        `Settings file not found: ${settingsPath}. ` +
        `Please run Claude CLI first or set CLAUDE_SETTINGS_PATH environment variable.`
      );
    }

    // Read and parse settings
    let settings: ClaudeSettings;
    try {
      const content = readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(content) as ClaudeSettings;
    } catch (err) {
      throw new ClaudeConfigError(
        `Failed to read settings file: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined }
      );
    }

    // Extract configuration from env
    const env = settings.env ?? {};
    const baseUrl = env.ANTHROPIC_BASE_URL;
    const apiKey = env.ANTHROPIC_AUTH_TOKEN ?? env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      throw new ClaudeConfigError(
        `No API key found in settings. ` +
        `Expected ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY in env.`
      );
    }

    // Initialize Anthropic client
    this.client = new Anthropic({
      apiKey,
      baseURL: baseUrl,
    });

    // Resolve model
    this.model = resolveModel(settings);

    // Build system prompt with workspace context
    const dir = this.config.workspaceDir ?? process.cwd();
    this.systemPrompt =
      `You are a helpful AI coding assistant. ` +
      `The user's working directory is: ${dir}\n` +
      `Always use paths relative to this directory unless the user specifies otherwise.`;

    this.initialized = true;
    logger.info("Claude adapter initialized", { model: this.model, baseUrl: baseUrl ?? 'default' });
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.client || !this.model) {
      throw new ClaudeConfigError('ClaudeAdapter not initialized. Call initialize() first.');
    }
  }

  async createSession(title?: string): Promise<ToolSession> {
    this.ensureInitialized();

    const id = generateSessionId();
    const now = Date.now();

    const session: ClaudeSession = {
      id,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(id, session);

    logger.info("Claude session created", { id, title });

    return {
      id,
      title,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    };
  }

  async sendMessage(
    sessionId: string,
    content: string,
    parts?: ToolMessagePart[],
  ): Promise<ToolResponse> {
    this.ensureInitialized();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ClaudeSessionError(`Session not found: ${sessionId}`);
    }

    // Build user message content
    const userContent = this.buildUserContent(content, parts);

    // Add user message to history
    session.messages.push({ role: 'user', content: userContent });

    logger.info("Sending message to Claude", { sessionId, contentLength: content.length });

    // Call API (non-streaming)
    const response = await this.client!.messages.create({
      model: this.model!,
      max_tokens: 4096,
      system: this.systemPrompt!,
      messages: session.messages,
    });

    // Extract text from response
    const text = this.extractText(response);

    // Add assistant message to history
    session.messages.push({ role: 'assistant', content: response.content });
    session.updatedAt = Date.now();

    return {
      id: response.id,
      sessionId,
      text,
      parts: [{ type: 'text', text }],
      tokens: response.usage ? {
        input: response.usage.input_tokens,
        output: response.usage.output_tokens,
      } : undefined,
    };
  }

  async sendAndStream(
    sessionId: string,
    content: string,
    parts: ToolMessagePart[] | undefined,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    this.ensureInitialized();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ClaudeSessionError(`Session not found: ${sessionId}`);
    }

    // Build user message content
    const userContent = this.buildUserContent(content, parts);

    // Add user message to history
    session.messages.push({ role: 'user', content: userContent });

    logger.info("Sending message to Claude (streaming)", { sessionId, contentLength: content.length });

    // Collect assistant content for history
    const assistantContent: Anthropic.ContentBlock[] = [];
    let currentText = '';

    try {
      // Create streaming request
      const stream = this.client!.messages.stream({
        model: this.model!,
        max_tokens: 4096,
        system: this.systemPrompt!,
        messages: session.messages,
      });

      // Process streaming events
      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'text') {
            currentText = '';
          }
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta.type === 'text_delta' && delta.text) {
            onChunk({ type: 'text', text: delta.text });
            currentText += delta.text;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentText) {
            assistantContent.push({ type: 'text', text: currentText } as Anthropic.TextBlock);
            currentText = '';
          }
        } else if (event.type === 'message_stop') {
          onChunk({ type: 'done' });
        }
      }

      // Get final message for potential error handling
      await stream.finalMessage();

      // Add assistant message to history
      if (assistantContent.length > 0) {
        session.messages.push({ role: 'assistant', content: assistantContent });
        session.updatedAt = Date.now();
      }

      logger.info("Claude stream completed", { sessionId });
    } catch (err) {
      onChunk({
        type: 'error',
        error: err instanceof Error ? err.message : 'Stream error',
      });
      logger.error("Claude stream error", { sessionId, error: err });
    }
  }

  async streamResponse(
    sessionId: string,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    // Claude API doesn't support subscribing to events separately
    // This method is a no-op for Claude (unlike OpenCode)
    logger.warn("streamResponse called on ClaudeAdapter - this is a no-op");
    onChunk({ type: 'done' });
  }

  async abortSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    // Claude API doesn't have an abort endpoint
    // Just log and return
    logger.info("Abort requested for Claude session", { sessionId });
  }

  async getSessionInfo(sessionId: string): Promise<ToolSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ClaudeSessionError(`Session not found: ${sessionId}`);
    }

    return {
      id: session.id,
      status: 'idle',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    };
  }

  async dispose(): Promise<void> {
    this.sessions.clear();
    this.client = null;
    this.initialized = false;
    logger.info("Claude adapter disposed");
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private buildUserContent(
    content: string,
    parts?: ToolMessagePart[],
  ): Anthropic.ContentBlock[] {
    const blocks: Anthropic.ContentBlock[] = [];

    // Add text content
    if (content) {
      blocks.push({ type: 'text', text: content } as Anthropic.TextBlock);
    }

    // Add additional parts
    if (parts) {
      for (const part of parts) {
        if (part.type === 'text' && part.text) {
          blocks.push({ type: 'text', text: part.text } as Anthropic.TextBlock);
        } else if (part.type === 'file') {
          // Claude API supports documents via base64
          // For now, log a warning - file handling would require downloading the file
          logger.warn("File part received but not yet supported", { filename: part.filename });
        }
      }
    }

    return blocks;
  }

  private extractText(response: Anthropic.Message): string {
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      }
    }
    return text;
  }
}
