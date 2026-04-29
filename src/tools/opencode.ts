import type { ToolAdapter } from './adapter';
import type {
  ToolSession,
  ToolResponse,
  StreamChunk,
  ToolMessagePart,
  ToolAdapterError,
} from '@/types/tool';
import {
  createOpencode,
  createOpencodeClient,
  type OpencodeClient,
} from '@opencode-ai/sdk';
import type {
  Session,
  Part,
  TextPart,
  Event,
  EventMessagePartUpdated,
  EventSessionIdle,
  EventSessionError,
} from '@opencode-ai/sdk';
import { createLogger } from "@/log";

const logger = createLogger("opencode");

/** Configuration for the OpenCode adapter */
export interface OpenCodeConfig {
  /** Port for the OpenCode server (default: 4096) */
  port?: number;
  /** Hostname for the OpenCode server (default: 'localhost') */
  hostname?: string;
  /** Model to use (format: 'provider/model') */
  model?: string;
  /** Working directory for the OpenCode server */
  directory?: string;
  /** If true, connect to an existing server instead of starting one */
  connectOnly?: boolean;
}

/** Map OpenCode Session to our ToolSession */
function mapSession(session: Session): ToolSession {
  return {
    id: session.id,
    title: session.title || undefined,
    status: 'idle' as ToolSession['status'],
    createdAt: session.time.created,
    updatedAt: session.time.updated,
  };
}

/** Extract text content from OpenCode response parts */
function extractText(parts: Part[]): string {
  let text = '';
  for (const part of parts) {
    if (part.type === 'text') {
      text += (part as TextPart).text;
    }
  }
  return text;
}

/** Map OpenCode message parts to our ToolMessagePart[] */
function mapParts(parts: Part[]): ToolMessagePart[] {
  const result: ToolMessagePart[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      result.push({ type: 'text', text: (part as TextPart).text });
    } else if (part.type === 'file') {
      const fp = part as Part & { mime: string; url: string; filename?: string };
      result.push({ type: 'file', mime: fp.mime, url: fp.url, filename: fp.filename });
    }
  }
  return result;
}

export class OpenCodeConnectionError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`OpenCode connection error: ${message}`, options);
    this.name = "OpenCodeConnectionError";
  }
}

export class OpenCodeSessionError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`OpenCode session error: ${message}`, options);
    this.name = "OpenCodeSessionError";
  }
}

export class OpenCodeTimeoutError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`OpenCode timeout error: ${message}`, options);
    this.name = "OpenCodeTimeoutError";
  }
}

function wrapSDKError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  const cause = err instanceof Error ? err : undefined;
  const lower = message.toLowerCase();
  if (lower.includes("timeout") || lower.includes("timed out")) {
    throw new OpenCodeTimeoutError(message, { cause });
  }
  if (lower.includes("network") || lower.includes("connection") || lower.includes("erefuse")) {
    throw new OpenCodeConnectionError(message, { cause });
  }
  throw new OpenCodeSessionError(message, { cause });
}

/**
 * OpenCode implementation of the ToolAdapter interface.
 * Uses the @opencode-ai/sdk to communicate with an OpenCode server.
 */
export class OpenCodeAdapter implements ToolAdapter {
  readonly name = 'opencode';

  private client: OpencodeClient | null = null;
  private server: { url: string; close: () => void } | null = null;
  private initialized = false;
  private readonly config: Required<Pick<OpenCodeConfig, 'port' | 'hostname' | 'directory'>> &
    Pick<OpenCodeConfig, 'model' | 'connectOnly'>;

  constructor(config: OpenCodeConfig = {}) {
    this.config = {
      port: config.port ?? 4096,
      hostname: config.hostname ?? 'localhost',
      directory: config.directory ?? process.cwd(),
      model: config.model,
      connectOnly: config.connectOnly ?? false,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info("Initializing OpenCode adapter", { connectOnly: this.config.connectOnly, hostname: this.config.hostname, port: this.config.port });

    try {
      if (this.config.connectOnly) {
        // Connect to an existing server
        this.client = createOpencodeClient({
          baseUrl: `http://${this.config.hostname}:${this.config.port}`,
        });
      } else {
        // Start a new server and create client
        const { client, server } = await createOpencode({
          port: this.config.port,
          hostname: this.config.hostname,
          config: this.config.model ? { model: this.config.model } : undefined,
        });
        this.client = client;
        this.server = server;
      }
    } catch (err) {
      logger.error("Failed to initialize OpenCode adapter", { error: err instanceof Error ? err.message : String(err) });
      throw new OpenCodeConnectionError(
        err instanceof Error ? err.message : String(err),
        { cause: err instanceof Error ? err : undefined },
      );
    }

    this.initialized = true;
    logger.info("OpenCode adapter initialized successfully");
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.client) {
      throw new Error('OpenCodeAdapter not initialized. Call initialize() first.') as ToolAdapterError;
    }
  }

  async createSession(title?: string): Promise<ToolSession> {
    this.ensureInitialized();

    logger.info("Creating OpenCode session", { title });

    let result;
    try {
      result = await this.client!.session.create({
        body: { title },
        query: { directory: this.config.directory },
      });
    } catch (err) {
      wrapSDKError(err);
    }

    if (!result.data) {
      throw new OpenCodeSessionError('Failed to create session: no data returned');
    }

    const session = mapSession(result.data as Session);
    logger.info("OpenCode session created", { id: session.id });
    return session;
  }

  async sendMessage(
    sessionId: string,
    content: string,
    parts?: ToolMessagePart[],
  ): Promise<ToolResponse> {
    this.ensureInitialized();

    logger.info("Sending message to OpenCode", { sessionId, contentLength: content.length });

    // Build the parts array for the prompt
    const promptParts: Array<Record<string, unknown>> = [];

    // Add text content
    promptParts.push({ type: 'text', text: content });

    // Add additional parts if provided
    if (parts) {
      for (const part of parts) {
        if (part.type === 'file') {
          promptParts.push({ type: 'file', mime: part.mime, url: part.url, filename: part.filename });
        }
        // text parts from the parts array are additional text segments
        if (part.type === 'text') {
          promptParts.push({ type: 'text', text: part.text });
        }
      }
    }

    let result;
    try {
      result = await this.client!.session.prompt({
        path: { id: sessionId },
        body: {
          parts: promptParts as any,
          model: this.config.model
            ? { providerID: this.config.model.split('/')[0], modelID: this.config.model.split('/')[1] }
            : undefined,
        },
        query: { directory: this.config.directory },
      });
    } catch (err) {
      wrapSDKError(err);
    }

    if (!result.data) {
      throw new OpenCodeSessionError('Failed to send message: no data returned');
    }

    const response = result.data as { info: { id: string; sessionID: string; tokens?: { input: number; output: number } }; parts: Part[] };

    return {
      id: response.info.id,
      sessionId: response.info.sessionID,
      text: extractText(response.parts),
      parts: mapParts(response.parts),
      tokens: response.info.tokens
        ? { input: response.info.tokens.input, output: response.info.tokens.output }
        : undefined,
    };
  }

  /**
   * Send a message to a session and stream the response in real-time.
   *
   * The correct flow for OpenCode streaming is:
   * 1. Subscribe to SSE events first
   * 2. Send the prompt via session.prompt() WITHOUT awaiting
   * 3. Collect streaming events as they arrive in parallel
   * 4. Return when the session becomes idle
   *
   * IMPORTANT: session.prompt() blocks until the full response is ready.
   * If we await it first, all SSE events will have already been emitted
   * before we start listening. So we must process events in parallel.
   *
   * @param sessionId The session ID to send the message to
   * @param content The text content of the message
   * @param parts Optional additional parts (files, images)
   * @param onChunk Callback invoked with each streaming chunk
   */
  async sendAndStream(
    sessionId: string,
    content: string,
    parts: ToolMessagePart[] | undefined,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    this.ensureInitialized();

    // Step 1: Subscribe to SSE events BEFORE sending the prompt
    let eventStream;
    try {
      logger.debug("Subscribing to SSE events");
      eventStream = await this.client!.event.subscribe({
        query: { directory: this.config.directory },
      });
    } catch (err) {
      throw new OpenCodeConnectionError(
        `Failed to subscribe to events: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err instanceof Error ? err : undefined },
      );
    }

    // Step 2: Build prompt parts
    const promptParts: Array<Record<string, unknown>> = [];
    promptParts.push({ type: 'text', text: content });
    if (parts) {
      for (const part of parts) {
        if (part.type === 'file') {
          promptParts.push({ type: 'file', mime: part.mime, url: part.url, filename: part.filename });
        }
        if (part.type === 'text') {
          promptParts.push({ type: 'text', text: part.text });
        }
      }
    }

    // Step 3: Send the prompt WITHOUT awaiting — events arrive via SSE in parallel
    // We fire-and-forget the prompt call; the response comes through the event stream.
    logger.info("Sending prompt to OpenCode", { sessionId, contentLength: content.length });
    const promptPromise = this.client!.session.prompt({
      path: { id: sessionId },
      body: {
        parts: promptParts as any,
        model: this.config.model
          ? { providerID: this.config.model.split('/')[0], modelID: this.config.model.split('/')[1] }
          : undefined,
      },
      query: { directory: this.config.directory },
    }).catch((err: unknown) => {
      // Log but don't throw — the error will surface via SSE events or stream end
      onChunk({
        type: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // Step 4: Collect streaming events as they arrive
    try {
      for await (const event of eventStream.stream) {
        const payload = event as Event;
        logger.debug("Stream event received", { type: payload.type });

        if (payload.type === 'message.part.updated') {
          const partEvent = payload as EventMessagePartUpdated;
          const part = partEvent.properties.part;

          if (part.type === 'text') {
            const textPart = part as TextPart;
            onChunk({
              type: 'text',
              text: partEvent.properties.delta ?? textPart.text,
            });
          } else if (part.type === 'tool') {
            const toolPart = part as Part & { tool: string; state: { status: string } };
            if (toolPart.state.status === 'running') {
              onChunk({ type: 'tool_start', toolName: toolPart.tool });
            } else if (toolPart.state.status === 'completed' || toolPart.state.status === 'error') {
              onChunk({ type: 'tool_end', toolName: toolPart.tool });
            }
          }
        } else if (payload.type === 'session.idle') {
          const idleEvent = payload as EventSessionIdle;
          if (idleEvent.properties.sessionID === sessionId) {
            onChunk({ type: 'done' });
            logger.info("OpenCode stream completed", { sessionId });
            // Wait for prompt to complete before returning
            await promptPromise;
            return;
          }
        } else if (payload.type === 'session.error') {
          const errorEvent = payload as EventSessionError;
          onChunk({
            type: 'error',
            error: errorEvent.properties.error
              ? (errorEvent.properties.error as { data?: { message?: string } }).data?.message ?? 'Unknown session error'
              : 'Unknown session error',
          });
          return;
        }
      }
    } catch (err) {
      onChunk({
        type: 'error',
        error: err instanceof Error ? err.message : 'Stream error',
      });
      logger.error("OpenCode stream error", { sessionId, error: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) });
    }
  }

  /**
   * Stream response from a session (legacy method).
   * Prefer sendAndStream() which handles both sending and streaming.
   * This method only subscribes to events — it does NOT send a prompt.
   */
  async streamResponse(
    sessionId: string,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    this.ensureInitialized();

    let eventStream;
    try {
      eventStream = await this.client!.event.subscribe({
        query: { directory: this.config.directory },
      });
    } catch (err) {
      wrapSDKError(err);
    }

    try {
      for await (const event of eventStream.stream) {
        const payload = event as Event;

        if (payload.type === 'message.part.updated') {
          const partEvent = payload as EventMessagePartUpdated;
          const part = partEvent.properties.part;

          if (part.type === 'text') {
            const textPart = part as TextPart;
            onChunk({
              type: 'text',
              text: partEvent.properties.delta ?? textPart.text,
            });
          } else if (part.type === 'tool') {
            const toolPart = part as Part & { tool: string; state: { status: string } };
            if (toolPart.state.status === 'running') {
              onChunk({ type: 'tool_start', toolName: toolPart.tool });
            } else if (toolPart.state.status === 'completed' || toolPart.state.status === 'error') {
              onChunk({ type: 'tool_end', toolName: toolPart.tool });
            }
          }
        } else if (payload.type === 'session.idle') {
          const idleEvent = payload as EventSessionIdle;
          if (idleEvent.properties.sessionID === sessionId) {
            onChunk({ type: 'done' });
            return;
          }
        } else if (payload.type === 'session.error') {
          const errorEvent = payload as EventSessionError;
          onChunk({
            type: 'error',
            error: errorEvent.properties.error
              ? (errorEvent.properties.error as { data?: { message?: string } }).data?.message ?? 'Unknown session error'
              : 'Unknown session error',
          });
          return;
        }
      }
    } catch (err) {
      onChunk({
        type: 'error',
        error: err instanceof Error ? err.message : 'Stream error',
      });
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    try {
      await this.client!.session.abort({
        path: { id: sessionId },
        query: { directory: this.config.directory },
      });
    } catch (err) {
      wrapSDKError(err);
    }
  }

  async getSessionInfo(sessionId: string): Promise<ToolSession> {
    this.ensureInitialized();

    let result;
    try {
      result = await this.client!.session.get({
        path: { id: sessionId },
        query: { directory: this.config.directory },
      });
    } catch (err) {
      wrapSDKError(err);
    }

    if (!result.data) {
      throw new OpenCodeSessionError(`Session not found: ${sessionId}`);
    }

    return mapSession(result.data as Session);
  }

  async dispose(): Promise<void> {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.client = null;
    this.initialized = false;
  }
}