/**
 * Codex Adapter — ToolAdapter implementation for OpenAI Codex CLI.
 *
 * Communicates with `codex app-server` via JSON-RPC 2.0 over stdio (JSONL).
 * Manages ephemeral Threads (no persistence).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import * as os from "node:os";
import type { ToolAdapter } from "./adapter";
import type {
  ToolSession,
  ToolResponse,
  StreamChunk,
  ToolMessagePart,
} from "@/types/tool";
import { createLogger } from "@/log";

const logger = createLogger("codex");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for the Codex adapter */
export interface CodexConfig {
  /** Path to Codex CLI (default: 'codex') */
  codexPath?: string;
  /** Working directory */
  workspaceDir?: string;
}

/** JSON-RPC request */
interface JsonRpcRequest {
  method: string;
  id: number;
  params: unknown;
}

/** JSON-RPC response */
interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** JSON-RPC notification */
interface JsonRpcNotification {
  method: string;
  params: unknown;
}

/** Initialize response from app-server */
interface InitializeResponse {
  userAgent: string;
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

/** Thread object */
interface CodexThread {
  id: string;
  preview: string;
  ephemeral: boolean;
  modelProvider: string;
  createdAt: number;
}

/** Turn object */
interface CodexTurn {
  id: string;
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: { message: string } | null;
}

/** Thread item (message, command, etc.) */
interface CodexThreadItem {
  type: string;
  id: string;
  [key: string]: unknown;
}

/** Turn started notification */
interface TurnStartedNotification {
  threadId: string;
  turn: CodexTurn;
}

/** Turn completed notification */
interface TurnCompletedNotification {
  threadId: string;
  turn: CodexTurn;
}

/** Agent message delta notification */
interface AgentMessageDeltaNotification {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

/** Item started/completed notification */
interface ItemNotification {
  item: CodexThreadItem;
  threadId: string;
  turnId: string;
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class CodexConfigError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`Codex config error: ${message}`, options);
    this.name = "CodexConfigError";
  }
}

export class CodexSessionError extends Error {
  constructor(message: string, options?: { cause?: Error }) {
    super(`Codex session error: ${message}`, options);
    this.name = "CodexSessionError";
  }
}

// ---------------------------------------------------------------------------
// JSON-RPC Client
// ---------------------------------------------------------------------------

/**
 * Lightweight JSON-RPC client for communicating with codex app-server.
 */
class JsonRpcClient {
  private process: ChildProcess | null = null;
  private readline: Interface | null = null;
  private nextId = 1;
  private pendingRequests = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (err: Error) => void }
  >();
  private notificationHandlers = new Map<string, (params: unknown) => void>();

  async start(codexPath: string, cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info("Starting codex app-server", { codexPath, cwd });

      // On Windows, need shell: true to resolve .cmd/.bat files
      const useShell = os.platform() === "win32";

      this.process = spawn(codexPath, ["app-server"], {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        shell: useShell,
      });

      this.process.on("error", (err) => {
        logger.error("Failed to start codex app-server", { error: err });
        reject(
          new CodexConfigError(
            `Failed to start codex app-server: ${err.message}. Please ensure @openai/codex is installed and OPENAI_API_KEY is set.`
          )
        );
      });

      if (!this.process.stdout) {
        reject(new CodexConfigError("Failed to get stdout from codex process"));
        return;
      }

      this.readline = createInterface({
        input: this.process.stdout,
        crlfDelay: Infinity,
      });

      this.readline.on("line", (line) => {
        this.handleLine(line);
      });

      // Log stderr for debugging
      if (this.process.stderr) {
        this.process.stderr.on("data", (data) => {
          logger.debug("codex stderr", { data: data.toString() });
        });
      }

      // Give the process a moment to start
      setTimeout(resolve, 100);
    });
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line);

      // Response (has id and result or error)
      if ("id" in msg && ("result" in msg || "error" in msg)) {
        const response = msg as JsonRpcResponse;
        const pending = this.pendingRequests.get(response.id);
        if (pending) {
          this.pendingRequests.delete(response.id);
          if (response.error) {
            pending.reject(
              new CodexSessionError(
                response.error.message || "Unknown JSON-RPC error"
              )
            );
          } else {
            pending.resolve(response.result);
          }
        }
      }
      // Notification (has method but no id)
      else if ("method" in msg && !("id" in msg)) {
        const notification = msg as JsonRpcNotification;
        const handler = this.notificationHandlers.get(notification.method);
        if (handler) {
          handler(notification.params);
        }
      }
    } catch (err) {
      logger.warn("Failed to parse JSON-RPC message", {
        line,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async sendRequest<T>(method: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new CodexSessionError("Codex process not running"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = { method, id, params };
      const message = JSON.stringify(request) + "\n";

      this.pendingRequests.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });

      this.process.stdin.write(message);
      logger.debug("Sent JSON-RPC request", { method, id });
    });
  }

  sendNotification(method: string, params: unknown): void {
    if (!this.process?.stdin) {
      throw new CodexSessionError("Codex process not running");
    }

    const notification: Omit<JsonRpcNotification, "id"> = { method, params };
    const message = JSON.stringify(notification) + "\n";
    this.process.stdin.write(message);
    logger.debug("Sent JSON-RPC notification", { method });
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  stop(): void {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    // Reject all pending requests
    for (const [id, { reject }] of this.pendingRequests) {
      reject(new CodexSessionError("Codex process stopped"));
    }
    this.pendingRequests.clear();
    this.notificationHandlers.clear();
  }
}

// ---------------------------------------------------------------------------
// CodexAdapter
// ---------------------------------------------------------------------------

/**
 * Codex CLI implementation of the ToolAdapter interface.
 * Uses JSON-RPC over stdio to communicate with codex app-server.
 */
export class CodexAdapter implements ToolAdapter {
  readonly name = "codex";

  private client: JsonRpcClient | null = null;
  private initialized = false;
  private readonly config: Required<Pick<CodexConfig, "codexPath">> &
    Pick<CodexConfig, "workspaceDir">;

  /** Current thread info */
  private currentThread: {
    id: string;
    turnId: string | null;
  } | null = null;

  /** In-memory session storage */
  private sessions = new Map<string, { threadId: string; createdAt: number }>();

  constructor(config: CodexConfig = {}) {
    this.config = {
      codexPath: config.codexPath ?? "codex",
      workspaceDir: config.workspaceDir,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    logger.info("Initializing Codex adapter", { codexPath: this.config.codexPath });

    this.client = new JsonRpcClient();

    const cwd = this.config.workspaceDir ?? process.cwd();
    await this.client.start(this.config.codexPath, cwd);

    // JSON-RPC handshake: initialize request
    const initResponse = await this.client.sendRequest<InitializeResponse>(
      "initialize",
      {
        clientInfo: {
          name: "code-in-wechat",
          title: "Code in WeChat",
          version: "1.0.0",
        },
        capabilities: { experimentalApi: true },
      }
    );

    logger.info("Codex app-server initialized", {
      userAgent: initResponse.userAgent,
      platformOs: initResponse.platformOs,
    });

    // Send initialized notification
    this.client.sendNotification("initialized", null);

    this.initialized = true;
    logger.info("Codex adapter initialized successfully");
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.client) {
      throw new CodexConfigError(
        "CodexAdapter not initialized. Call initialize() first."
      );
    }
  }

  async createSession(title?: string): Promise<ToolSession> {
    this.ensureInitialized();

    logger.info("Creating Codex thread", { title });

    const cwd = this.config.workspaceDir ?? process.cwd();

    // Start an ephemeral thread with full-auto approval
    const response = await this.client!.sendRequest<{ thread: CodexThread }>(
      "thread/start",
      {
        cwd,
        ephemeral: true,
        approvalPolicy: "never",
      }
    );

    const thread = response.thread;

    // Store session mapping
    const sessionId = thread.id;
    this.sessions.set(sessionId, {
      threadId: thread.id,
      createdAt: Date.now(),
    });

    // Update current thread
    this.currentThread = { id: thread.id, turnId: null };

    logger.info("Codex thread created", { threadId: thread.id });

    return {
      id: sessionId,
      title,
      status: "idle",
      createdAt: thread.createdAt * 1000,
      updatedAt: Date.now(),
    };
  }

  async sendMessage(
    sessionId: string,
    content: string,
    parts?: ToolMessagePart[]
  ): Promise<ToolResponse> {
    this.ensureInitialized();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new CodexSessionError(`Session not found: ${sessionId}`);
    }

    logger.info("Sending message to Codex", { sessionId, contentLength: content.length });

    // Collect response text
    let responseText = "";

    return new Promise((resolve, reject) => {
      // Set up notification handlers
      const handleDelta = (params: unknown) => {
        const delta = params as AgentMessageDeltaNotification;
        if (delta.threadId === session.threadId) {
          responseText += delta.delta;
        }
      };

      const handleTurnCompleted = (params: unknown) => {
        const completed = params as TurnCompletedNotification;
        if (completed.threadId === session.threadId) {
          this.client!.onNotification("item/agentMessage/delta", () => {});
          this.client!.onNotification("turn/completed", () => {});

          if (completed.turn.status === "failed") {
            reject(
              new CodexSessionError(
                completed.turn.error?.message || "Turn failed"
              )
            );
          } else {
            resolve({
              id: completed.turn.id,
              sessionId,
              text: responseText,
              parts: [{ type: "text", text: responseText }],
            });
          }
        }
      };

      this.client!.onNotification("item/agentMessage/delta", handleDelta);
      this.client!.onNotification("turn/completed", handleTurnCompleted);

      // Send turn/start request
      this.client!.sendRequest<{ turn: CodexTurn }>("turn/start", {
        threadId: session.threadId,
        input: [{ type: "text", text: content }],
      }).catch(reject);
    });
  }

  async sendAndStream(
    sessionId: string,
    content: string,
    parts: ToolMessagePart[] | undefined,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    this.ensureInitialized();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new CodexSessionError(`Session not found: ${sessionId}`);
    }

    logger.info("Sending message to Codex (streaming)", {
      sessionId,
      contentLength: content.length,
    });

    return new Promise((resolve, reject) => {
      let currentTurnId: string | null = null;
      let runningTools = new Set<string>();

      // Handle agent message delta
      this.client!.onNotification(
        "item/agentMessage/delta",
        (params: unknown) => {
          const delta = params as AgentMessageDeltaNotification;
          if (delta.threadId === session.threadId && delta.turnId === currentTurnId) {
            onChunk({ type: "text", text: delta.delta });
          }
        }
      );

      // Handle item started (for tool_start)
      this.client!.onNotification("item/started", (params: unknown) => {
        const item = params as ItemNotification;
        if (item.threadId === session.threadId && item.turnId === currentTurnId) {
          if (item.item.type === "commandExecution") {
            const cmd = item.item as CodexThreadItem & { command: string };
            runningTools.add(item.item.id);
            onChunk({ type: "tool_start", toolName: cmd.command.split(" ")[0] || "command" });
          }
        }
      });

      // Handle item completed (for tool_end)
      this.client!.onNotification("item/completed", (params: unknown) => {
        const item = params as ItemNotification;
        if (item.threadId === session.threadId && item.turnId === currentTurnId) {
          if (runningTools.has(item.item.id)) {
            runningTools.delete(item.item.id);
            onChunk({ type: "tool_end", toolName: "command" });
          }
        }
      });

      // Handle turn completed
      this.client!.onNotification(
        "turn/completed",
        (params: unknown) => {
          const completed = params as TurnCompletedNotification;
          if (completed.threadId === session.threadId && completed.turn.id === currentTurnId) {
            // Clear handlers
            this.client!.onNotification("item/agentMessage/delta", () => {});
            this.client!.onNotification("item/started", () => {});
            this.client!.onNotification("item/completed", () => {});
            this.client!.onNotification("turn/completed", () => {});

            if (completed.turn.status === "failed") {
              onChunk({
                type: "error",
                error: completed.turn.error?.message || "Turn failed",
              });
              reject(new CodexSessionError(completed.turn.error?.message || "Turn failed"));
            } else if (completed.turn.status === "interrupted") {
              onChunk({ type: "error", error: "Turn interrupted" });
              resolve();
            } else {
              onChunk({ type: "done" });
              resolve();
            }
          }
        }
      );

      // Send turn/start request
      this.client!.sendRequest<{ turn: CodexTurn }>("turn/start", {
        threadId: session.threadId,
        input: [{ type: "text", text: content }],
      })
        .then((response) => {
          currentTurnId = response.turn.id;
          if (this.currentThread) {
            this.currentThread.turnId = currentTurnId;
          }
          logger.debug("Turn started", { turnId: currentTurnId });
        })
        .catch((err) => {
          onChunk({ type: "error", error: err.message });
          reject(err);
        });
    });
  }

  async streamResponse(
    sessionId: string,
    onChunk: (chunk: StreamChunk) => void
  ): Promise<void> {
    // Codex uses turn-based streaming, not separate subscription
    logger.warn("streamResponse called on CodexAdapter - this is a no-op");
    onChunk({ type: "done" });
  }

  async abortSession(sessionId: string): Promise<void> {
    this.ensureInitialized();

    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new CodexSessionError(`Session not found: ${sessionId}`);
    }

    if (!this.currentThread?.turnId) {
      logger.warn("No active turn to abort", { sessionId });
      return;
    }

    logger.info("Aborting Codex turn", {
      sessionId,
      threadId: session.threadId,
      turnId: this.currentThread.turnId,
    });

    try {
      await this.client!.sendRequest("turn/interrupt", {
        threadId: session.threadId,
        turnId: this.currentThread.turnId,
      });
    } catch (err) {
      logger.warn("Failed to abort turn", { error: err });
    }
  }

  async getSessionInfo(sessionId: string): Promise<ToolSession> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new CodexSessionError(`Session not found: ${sessionId}`);
    }

    return {
      id: sessionId,
      status: "idle",
      createdAt: session.createdAt,
      updatedAt: Date.now(),
    };
  }

  async dispose(): Promise<void> {
    logger.info("Disposing Codex adapter");

    if (this.client) {
      this.client.stop();
      this.client = null;
    }

    this.sessions.clear();
    this.currentThread = null;
    this.initialized = false;

    logger.info("Codex adapter disposed");
  }
}
