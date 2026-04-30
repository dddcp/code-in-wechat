/**
 * SwitchableAdapter — proxy that delegates ToolAdapter calls to the active adapter.
 *
 * Supports runtime switching between multiple ToolAdapter implementations
 * (e.g., OpenCodeAdapter, ClaudeAdapter).
 */

import type { ToolAdapter } from './adapter';
import type {
  ToolSession,
  ToolResponse,
  StreamChunk,
  ToolMessagePart,
} from '@/types/tool';
import { createLogger } from "@/log";

const logger = createLogger("switchable");

/** Result of a switch operation */
export interface SwitchResult {
  success: boolean;
  message: string;
  currentTool: string;
}

/**
 * Proxy implementation of ToolAdapter that delegates to the active adapter.
 */
export class SwitchableAdapter implements ToolAdapter {
  readonly name = 'switchable';

  private adapters: Map<string, ToolAdapter> = new Map();
  private current: string;

  constructor(adapters: Map<string, ToolAdapter>, defaultTool: string) {
    if (adapters.size === 0) {
      throw new Error('SwitchableAdapter requires at least one adapter');
    }

    this.adapters = adapters;

    if (!adapters.has(defaultTool)) {
      logger.warn(`Default tool "${defaultTool}" not found, using first available`);
      this.current = adapters.keys().next().value!;
    } else {
      this.current = defaultTool;
    }

    logger.info("SwitchableAdapter created", {
      tools: [...adapters.keys()],
      default: this.current,
    });
  }

  private getActive(): ToolAdapter {
    const adapter = this.adapters.get(this.current);
    if (!adapter) {
      throw new Error(`Active adapter "${this.current}" not found`);
    }
    return adapter;
  }

  // -----------------------------------------------------------------------
  // ToolAdapter interface (delegation)
  // -----------------------------------------------------------------------

  async initialize(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      try {
        logger.info(`Initializing adapter: ${name}`);
        await adapter.initialize();
      } catch (err) {
        logger.error(`Failed to initialize adapter: ${name}`, { error: err });
        throw err;
      }
    }
  }

  async createSession(title?: string): Promise<ToolSession> {
    return this.getActive().createSession(title);
  }

  async sendMessage(
    sessionId: string,
    content: string,
    parts?: ToolMessagePart[],
  ): Promise<ToolResponse> {
    return this.getActive().sendMessage(sessionId, content, parts);
  }

  async sendAndStream(
    sessionId: string,
    content: string,
    parts: ToolMessagePart[] | undefined,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    return this.getActive().sendAndStream(sessionId, content, parts, onChunk);
  }

  async streamResponse(
    sessionId: string,
    onChunk: (chunk: StreamChunk) => void,
  ): Promise<void> {
    return this.getActive().streamResponse(sessionId, onChunk);
  }

  async abortSession(sessionId: string): Promise<void> {
    return this.getActive().abortSession(sessionId);
  }

  async getSessionInfo(sessionId: string): Promise<ToolSession> {
    return this.getActive().getSessionInfo(sessionId);
  }

  async dispose(): Promise<void> {
    for (const [name, adapter] of this.adapters) {
      try {
        await adapter.dispose();
        logger.info(`Disposed adapter: ${name}`);
      } catch (err) {
        logger.error(`Error disposing adapter: ${name}`, { error: err });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Switching API
  // -----------------------------------------------------------------------

  switchTo(name: string): SwitchResult {
    if (!this.adapters.has(name)) {
      return {
        success: false,
        message: `Unknown tool: "${name}". Available: ${this.getAvailableTools().join(', ')}`,
        currentTool: this.current,
      };
    }

    const previous = this.current;
    this.current = name;
    logger.info(`Switched from ${previous} to ${name}`);

    return {
      success: true,
      message: `已切换到 ${name}`,
      currentTool: this.current,
    };
  }

  getCurrentTool(): string {
    return this.current;
  }

  getAvailableTools(): string[] {
    return [...this.adapters.keys()];
  }

  getAdapter(name: string): ToolAdapter | undefined {
    return this.adapters.get(name);
  }
}
