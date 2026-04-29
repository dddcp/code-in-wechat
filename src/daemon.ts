/**
 * Daemon — process-level lifecycle manager for the WeChat bot.
 *
 * Wraps MessageBridge with:
 * - Auto-reconnect on session expiry (ret=-14) with exponential backoff
 * - Health monitoring for iLink and OpenCode
 * - Signal handling (SIGINT/SIGTERM for shutdown, SIGUSR2 for restart)
 * - Max retry limit (default 5) with fatal exit
 */

import type { MessageBridge } from "@/bridge/message-bridge";
import type { AuthFlow } from "@/bridge/auth-flow";
import type { iLinkClient } from "@/wechat/ilink-client";
import type { ToolAdapter } from "@/tools/adapter";
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DaemonConfig {
  /** Base delay in ms for exponential backoff (default: 2000) */
  retryBaseMs?: number;
  /** Maximum delay in ms for backoff cap (default: 300000 = 5 min) */
  retryMaxMs?: number;
  /** Maximum consecutive retries before fatal exit (default: 5) */
  maxRetries?: number;
  /** iLink health check interval in ms (default: 30000) */
  ilinkHealthIntervalMs?: number;
  /** OpenCode health check interval in ms (default: 60000) */
  opencodeHealthIntervalMs?: number;
}

export interface HealthStatus {
  /** Whether the iLink connection is responsive */
  ilinkAlive: boolean;
  /** Whether the OpenCode adapter is responsive */
  opencodeAlive: boolean;
  /** Current retry attempt count (resets on successful recovery) */
  retryCount: number;
}

// ---------------------------------------------------------------------------
// Daemon
// ---------------------------------------------------------------------------

export class Daemon extends EventEmitter {
  private readonly bridge: MessageBridge;
  private readonly authFlow: AuthFlow;
  private readonly config: Required<
    Pick<
      DaemonConfig,
      | "retryBaseMs"
      | "retryMaxMs"
      | "maxRetries"
      | "ilinkHealthIntervalMs"
      | "opencodeHealthIntervalMs"
    >
  >;
  private readonly ilinkClient?: iLinkClient;
  private readonly toolAdapter?: ToolAdapter;

  private running = false;
  private retryCount = 0;
  private recovering = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private ilinkHealthTimer: ReturnType<typeof setInterval> | null = null;
  private opencodeHealthTimer: ReturnType<typeof setInterval> | null = null;
  private ilinkAlive = false;
  private opencodeAlive = false;

  /** Bound signal handlers for cleanup on stop() */
  private readonly sigintHandler: () => void;
  private readonly sigtermHandler: () => void;
  private readonly sigusr2Handler: () => void;
  private sessionExpiredHandler: (() => void) | null = null;

  constructor(
    bridge: MessageBridge,
    authFlow: AuthFlow,
    config?: DaemonConfig,
    iLinkClient?: iLinkClient,
    toolAdapter?: ToolAdapter,
  ) {
    super();
    this.bridge = bridge;
    this.authFlow = authFlow;
    this.ilinkClient = iLinkClient;
    this.toolAdapter = toolAdapter;
    this.config = {
      retryBaseMs: config?.retryBaseMs ?? 2000,
      retryMaxMs: config?.retryMaxMs ?? 300_000,
      maxRetries: config?.maxRetries ?? 5,
      ilinkHealthIntervalMs: config?.ilinkHealthIntervalMs ?? 30_000,
      opencodeHealthIntervalMs: config?.opencodeHealthIntervalMs ?? 60_000,
    };

    // Bind signal handlers once so we can remove them later
    this.sigintHandler = () => this.handleShutdownSignal("SIGINT");
    this.sigtermHandler = () => this.handleShutdownSignal("SIGTERM");
    this.sigusr2Handler = () => this.handleRestartSignal();
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the daemon: launch bridge, register signal handlers,
   * attach session-expired listener, and begin health monitoring.
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.retryCount = 0;

    this.registerSignalHandlers();

    try {
      await this.bridge.start();
    } catch (err) {
      console.error("Failed to start bridge:", err);
      this.scheduleRetry(err instanceof Error ? err : new Error(String(err)));
    }

    this.attachSessionExpiredListener();
    this.startHealthMonitoring();
  }

  /**
   * Gracefully shut down: stop health monitors, cancel retries,
   * detach session-expired listener, remove signal handlers, stop bridge.
   */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;

    this.removeSignalHandlers();
    this.stopHealthMonitoring();

    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    this.detachSessionExpiredListener();

    try {
      await this.bridge.stop();
    } catch (err) {
      console.error("Error stopping bridge:", err);
    }
  }

  /**
   * Return current health status of monitored components.
   */
  getHealthStatus(): HealthStatus {
    return {
      ilinkAlive: this.ilinkAlive,
      opencodeAlive: this.opencodeAlive,
      retryCount: this.retryCount,
    };
  }

  // -----------------------------------------------------------------------
  // Signal handling
  // -----------------------------------------------------------------------

  private registerSignalHandlers(): void {
    process.on("SIGINT" as NodeJS.Signals, this.sigintHandler);
    process.on("SIGTERM" as NodeJS.Signals, this.sigtermHandler);
    process.on("SIGUSR2" as NodeJS.Signals, this.sigusr2Handler);
  }

  private removeSignalHandlers(): void {
    process.off("SIGINT" as NodeJS.Signals, this.sigintHandler);
    process.off("SIGTERM" as NodeJS.Signals, this.sigtermHandler);
    process.off("SIGUSR2" as NodeJS.Signals, this.sigusr2Handler);
  }

  private async handleShutdownSignal(signal: string): Promise<void> {
    console.log(`Received ${signal}, shutting down gracefully...`);
    await this.stop();
    process.exit(0);
  }

  private async handleRestartSignal(): Promise<void> {
    console.log("Received SIGUSR2, restarting bridge...");
    try {
      await this.bridge.stop();
      await this.bridge.start();
      console.log("Bridge restarted via SIGUSR2");
    } catch (err) {
      console.error("Failed to restart bridge via SIGUSR2:", err);
    }
  }

  // -----------------------------------------------------------------------
  // Session-expired listener
  // -----------------------------------------------------------------------

  private attachSessionExpiredListener(): void {
    const sessionManager = (this.bridge as any).sessionManager;
    if (sessionManager && typeof sessionManager.on === "function") {
      this.sessionExpiredHandler = () => {
        this.handleSessionExpired().catch((err) => {
          console.error("Error in session-expired handler:", err);
        });
      };
      sessionManager.on("session-expired", this.sessionExpiredHandler);
    }
  }

  private detachSessionExpiredListener(): void {
    if (!this.sessionExpiredHandler) return;
    const sessionManager = (this.bridge as any).sessionManager;
    if (sessionManager && typeof sessionManager.off === "function") {
      sessionManager.off("session-expired", this.sessionExpiredHandler);
    }
    this.sessionExpiredHandler = null;
  }

  // -----------------------------------------------------------------------
  // Auto-reconnect
  // -----------------------------------------------------------------------

  /**
   * Handle session-expired event: attempt re-auth with retry logic.
   * The bridge's own handler may also run; the Daemon adds exponential
   * backoff retry on top of the bridge's basic recovery.
   */
  private async handleSessionExpired(): Promise<void> {
    if (this.recovering || !this.running) return;
    this.recovering = true;
    this.emit("session-expired");

    try {
      const result = await this.authFlow.login();
      if (result.success) {
        console.log("Re-authentication successful after session expiry");
        this.retryCount = 0;
        this.recovering = false;
        this.emit("recovered");
        // Restart the bridge cleanly to re-establish polling
        await this.bridge.stop();
        await this.bridge.start();
        // Re-attach session-expired listener (sessionManager is recreated)
        this.attachSessionExpiredListener();
        return;
      }

      console.error(
        "Re-authentication failed after session expiry:",
        result.error,
      );
      this.recovering = false;
      this.scheduleRetry(
        new Error(result.error ?? "Re-authentication failed"),
      );
    } catch (err) {
      this.recovering = false;
      this.scheduleRetry(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // -----------------------------------------------------------------------
  // Retry with exponential backoff
  // -----------------------------------------------------------------------

  /**
   * Schedule a retry with exponential backoff.
   * Delay = min(retryBaseMs * 2^attempt, retryMaxMs)
   * After maxRetries consecutive failures, perform a fatal exit.
   */
  private scheduleRetry(error: Error): void {
    if (!this.running) return;

    if (this.retryCount >= this.config.maxRetries) {
      console.error(
        `Max retries (${this.config.maxRetries}) exceeded. Fatal error: ${error.message}`,
      );
      this.fatalExit();
      return;
    }

    const delay = Math.min(
      this.config.retryBaseMs * Math.pow(2, this.retryCount),
      this.config.retryMaxMs,
    );
    this.retryCount++;

    console.log(`Retry ${this.retryCount}/${this.config.maxRetries} in ${delay}ms...`);
    this.emit("retry", { attempt: this.retryCount, delay, error });

    this.retryTimer = setTimeout(async () => {
      if (!this.running) return;
      this.retryTimer = null;

      try {
        // Attempt re-authentication first
        const authResult = await this.authFlow.login();
        if (!authResult.success) {
          throw new Error(
            authResult.error ?? "Re-authentication failed during retry",
          );
        }

        // Re-auth succeeded — restart bridge cleanly
        await this.bridge.stop();
        await this.bridge.start();
        console.log("Bridge restarted successfully after retry");
        this.retryCount = 0;
        this.emit("recovered");
        // Re-attach session-expired listener (sessionManager may have been recreated)
        this.attachSessionExpiredListener();
      } catch (err) {
        console.error("Retry failed:", err);
        this.scheduleRetry(err instanceof Error ? err : new Error(String(err)));
      }
    }, delay);
  }

  // -----------------------------------------------------------------------
  // Health monitoring
  // -----------------------------------------------------------------------

  private startHealthMonitoring(): void {
    // iLink health check
    if (this.ilinkClient) {
      this.ilinkAlive = true; // Assume alive at start
      this.ilinkHealthTimer = setInterval(async () => {
        await this.checkILinkHealth();
      }, this.config.ilinkHealthIntervalMs);
    }

    // OpenCode health check
    if (this.toolAdapter) {
      this.opencodeAlive = true; // Assume alive at start
      this.opencodeHealthTimer = setInterval(async () => {
        await this.checkOpenCodeHealth();
      }, this.config.opencodeHealthIntervalMs);
    }
  }

  private stopHealthMonitoring(): void {
    if (this.ilinkHealthTimer !== null) {
      clearInterval(this.ilinkHealthTimer);
      this.ilinkHealthTimer = null;
    }
    if (this.opencodeHealthTimer !== null) {
      clearInterval(this.opencodeHealthTimer);
      this.opencodeHealthTimer = null;
    }
  }

  private async checkILinkHealth(): Promise<void> {
    if (!this.ilinkClient) return;
    try {
      await this.ilinkClient.getUpdates("");
      this.ilinkAlive = true;
    } catch {
      this.ilinkAlive = false;
      this.emit("health-check-failed", { component: "ilink" });
    }
  }

  private async checkOpenCodeHealth(): Promise<void> {
    if (!this.toolAdapter) return;
    try {
      // Use getSessionInfo as a lightweight liveness probe.
      // A "session not found" error still means the server is alive.
      await this.toolAdapter.getSessionInfo("health-check");
      this.opencodeAlive = true;
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      // Connection/network errors indicate the server is down;
      // other errors (e.g., "session not found") mean it's still alive.
      if (
        msg.includes("connection") ||
        msg.includes("network") ||
        msg.includes("erefuse") ||
        msg.includes("timeout") ||
        msg.includes("econnrefused")
      ) {
        this.opencodeAlive = false;
        this.emit("health-check-failed", { component: "opencode" });
      } else {
        // Server responded (even with an error) — it's alive
        this.opencodeAlive = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Fatal exit
  // -----------------------------------------------------------------------

  private async fatalExit(): Promise<void> {
    console.error("Fatal error: max retries exceeded, exiting...");
    await this.stop();
    process.exit(1);
  }
}
