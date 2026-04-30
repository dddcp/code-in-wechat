/**
 * code-in-wechat — Entry point.
 *
 * Initialization order:
 *   1. Parse CLI args
 *   2. Load config (env vars + CLI overrides + defaults)
 *   3. Set log level
 *   4. Create iLinkClient
 *   5. Create OpenCodeAdapter (ToolAdapter)
 *   6. Create StreamHandler
 *   7. Create MediaHandler
 *   8. Create AuthFlow
 *   9. Create MessageBridge
 *  10. If --daemon: create Daemon and start it
 *  11. If not daemon: start MessageBridge directly
 *  12. Start web server
 */

import { parseArgs, getHelpText, getVersion, type ParsedArgs, type ParseError } from "@/cli";
import { loadConfig, type AppConfig } from "@/config/index";
import { iLinkClient } from "@/wechat/ilink-client";
import { OpenCodeAdapter } from "@/tools/opencode";
import { ClaudeAdapter } from "@/tools/claude";
import { CodexAdapter } from "@/tools/codex";
import { SwitchableAdapter } from "@/tools/switchable";
import { StreamHandler } from "@/bridge/stream-handler";
import { MediaHandler } from "@/bridge/media-handler";
import { AuthFlow } from "@/bridge/auth-flow";
import { MessageBridge, type MessageBridgeConfig } from "@/bridge/message-bridge";
import { Daemon } from "@/daemon";
import { createWebServer } from "@/web/server";
import { createLogger, setLogLevel } from "@/log";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const logger = createLogger("main");

// ---------------------------------------------------------------------------
// CLI handling
// ---------------------------------------------------------------------------

/**
 * Handle --help and --version early exits.
 * Returns true if the process should exit (help/version printed).
 */
async function handleEarlyExit(args: ParsedArgs): Promise<boolean> {
  if (args.help) {
    console.log(getHelpText());
    return true;
  }
  if (args.version) {
    const version = await getVersion();
    console.log(`code-in-wechat v${version}`);
    return true;
  }
  return false;
}

/**
 * Merge CLI args into config, with CLI args taking precedence.
 */
function mergeConfig(config: AppConfig, args: ParsedArgs): AppConfig {
  return {
    ilink: config.ilink,
    opencode: {
      ...config.opencode,
      ...(args.opencodePort !== undefined ? { port: args.opencodePort } : {}),
    },
    claude: config.claude,
    codex: config.codex,
    tool: config.tool,
    server: {
      ...config.server,
      ...(args.port !== undefined ? { port: args.port } : {}),
      ...(args.host !== undefined ? { host: args.host } : {}),
    },
    logging: {
      ...config.logging,
      ...(args.logLevel !== undefined ? { level: args.logLevel as "debug" | "info" | "warn" | "error" } : {}),
    },
    session_db_path: config.session_db_path,
  };
}

// ---------------------------------------------------------------------------
// Auth subcommand
// ---------------------------------------------------------------------------

async function runAuth(config: AppConfig): Promise<void> {
  logger.info("Running authentication flow...");

  // For auth, we need an iLinkClient but we don't have a bot_token yet.
  // Use the base_url from config; the AuthFlow will obtain the token.
  const client = new iLinkClient({
    base_url: config.ilink.base_url,
    bot_token: "", // Empty token — auth flow will obtain one
  });

  const authFlow = new AuthFlow(client, {
    botTokenPath: config.ilink.bot_token_path,
  });

  const result = await authFlow.login();
  if (result.success) {
    logger.info("Authentication successful!", {
      baseUrl: result.baseUrl,
    });
    process.exit(0);
  } else {
    logger.error("Authentication failed", { error: result.error });
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // Step 1: Parse CLI args
  const parsed = parseArgs(process.argv);

  // Handle parse errors
  if ("exitCode" in parsed) {
    const err = parsed as ParseError;
    console.error(err.message);
    process.exit(err.exitCode);
  }

  const args = parsed as ParsedArgs;

  // Handle --help / --version early exits
  if (await handleEarlyExit(args)) {
    process.exit(0);
  }

  // Step 2: Load config (env vars + defaults)
  const envConfig = loadConfig();

  // Merge CLI overrides into config
  const config = mergeConfig(envConfig, args);

  // Step 3: Set log level
  setLogLevel(config.logging.level as "debug" | "info" | "warn" | "error");
  logger.info("Starting code-in-wechat", { config });

  // Handle auth subcommand
  if (args.command === "auth") {
    await runAuth(config);
    return; // runAuth calls process.exit, but satisfy the type checker
  }

  // Step 4: Restore or obtain bot_token
  logger.info("Checking authentication...");
  const authFlow = new AuthFlow(
    new iLinkClient({
      base_url: config.ilink.base_url,
      bot_token: "", // Temporary — will be replaced after auth
    }),
    { botTokenPath: config.ilink.bot_token_path },
  );

  let botToken: string;
  let baseUrl: string;

  if (authFlow.isAuthenticated()) {
    logger.info("Found saved bot_token, restoring session...");
    const result = await authFlow.restoreSession();
    if (result.success && result.botToken && result.baseUrl) {
      botToken = result.botToken;
      baseUrl = result.baseUrl;
      logger.info("Session restored successfully");
    } else {
      logger.info("Saved token invalid, starting login flow...");
      const loginResult = await authFlow.login();
      if (!loginResult.success) {
        logger.error("Authentication failed", { error: loginResult.error });
        process.exit(1);
      }
      botToken = loginResult.botToken!;
      baseUrl = loginResult.baseUrl!;
    }
  } else {
    logger.info("No saved bot_token found, starting login flow...");
    const loginResult = await authFlow.login();
    if (!loginResult.success) {
      logger.error("Authentication failed", { error: loginResult.error });
      process.exit(1);
    }
    botToken = loginResult.botToken!;
    baseUrl = loginResult.baseUrl!;
  }

  // Step 5: Create iLinkClient with authenticated bot_token
  const client = new iLinkClient({
    base_url: baseUrl,
    bot_token: botToken,
  });

  // Step 6: Create tool adapters
  const adapters = new Map<string, import("@/tools/adapter").ToolAdapter>();

  adapters.set("opencode", new OpenCodeAdapter({
    port: config.opencode.port,
    hostname: config.opencode.hostname,
    model: config.opencode.model,
    directory: config.tool.workspaceDir,
  }));

  adapters.set("claude", new ClaudeAdapter({
    settingsPath: config.claude.settingsPath,
    workspaceDir: config.tool.workspaceDir,
  }));

  adapters.set("codex", new CodexAdapter({
    codexPath: config.codex.codexPath,
    workspaceDir: config.tool.workspaceDir,
  }));

  const toolAdapter = new SwitchableAdapter(adapters, config.tool.defaultTool);

  // Step 7: Create StreamHandler
  const streamHandler = new StreamHandler(client);

  // Step 8: Create MediaHandler
  const mediaHandler = new MediaHandler(client);

  // Step 9: Create AuthFlow (for session recovery)
  const sessionAuthFlow = new AuthFlow(client, {
    botTokenPath: config.ilink.bot_token_path,
  });

  // Step 10: Create MessageBridge
  const bridgeConfig: MessageBridgeConfig = {
    sessionDbPath: config.session_db_path,
    server: config.server,
    serverStarter: async (app, port, host) => {
      const server = createServer((req: IncomingMessage, res: ServerResponse) => {
        // Convert Node.js request to Web Request, then pass to Hono
        const url = `http://${req.headers.host ?? `${host}:${port}`}${req.url}`;
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
          const init: RequestInit = {
            method: req.method ?? "GET",
            headers: req.headers as Record<string, string>,
          };
          if (body) {
            init.body = body;
          }
          const webReq = new Request(url, init);
          Promise.resolve(app.fetch(webReq)).then((webRes: Response) => {
            res.statusCode = webRes.status;
            webRes.headers.forEach((v, k) => res.setHeader(k, v));
            webRes.arrayBuffer().then((buf) => {
              res.end(Buffer.from(buf));
            });
          }).catch((err: Error) => {
            logger.error("Web server error", { error: err });
            res.statusCode = 500;
            res.end("Internal Server Error");
          });
        });
      });
      server.listen(port, host, () => {
        logger.info(`Web server listening on http://${host}:${port}`);
      });
    },
  };

  const bridge = new MessageBridge(
    client,
    toolAdapter,
    streamHandler,
    mediaHandler,
    sessionAuthFlow,
    bridgeConfig,
  );

  // Step 11: Start based on daemon mode
  if (args.daemon) {
    logger.info("Starting in daemon mode...");
    const daemon = new Daemon(bridge, sessionAuthFlow, {}, client, toolAdapter);
    await daemon.start();
  } else {
    logger.info("Starting in foreground mode...");
    await bridge.start();
  }

  logger.info("code-in-wechat is running");
}

// ---------------------------------------------------------------------------
// Global error handlers
// ---------------------------------------------------------------------------

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", { reason });
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch((err) => {
  logger.error("Fatal error during startup", { error: err });
  process.exit(1);
});