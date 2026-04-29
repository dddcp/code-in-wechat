/**
 * CLI argument parser for code-in-wechat.
 *
 * Simple process.argv parser — no external dependencies.
 * Supports flags, options with values, and a single subcommand (auth).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ParsedArgs {
  /** Subcommand: "auth" to run auth flow only, undefined for default (start bot) */
  command?: "auth";
  /** Server port (overrides SERVER_PORT env) */
  port?: number;
  /** Server host (overrides SERVER_HOST env) */
  host?: string;
  /** OpenCode port (overrides OPENCODE_PORT env) */
  opencodePort?: number;
  /** Log level: debug | info | warn | error (overrides LOG_LEVEL env) */
  logLevel?: string;
  /** Run as daemon with auto-reconnect */
  daemon?: boolean;
  /** Show help text and exit */
  help?: boolean;
  /** Show version and exit */
  version?: boolean;
}

export interface ParseError {
  message: string;
  exitCode: number;
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `
code-in-wechat — WeChat bot that bridges WeChat messages with AI coding tools

Usage:
  code-in-wechat [options]          Start the bot (default)
  code-in-wechat auth [options]     Run authentication flow only

Options:
  --port <number>         Server port (default: 3000)
  --host <string>         Server host (default: localhost)
  --opencode-port <number> OpenCode server port (default: 4096)
  --log-level <string>    Log level: debug | info | warn | error (default: info)
  --daemon                Run as daemon with auto-reconnect
  --help                  Show this help text
  --version               Show version

Environment variables:
  SERVER_PORT             Server port
  SERVER_HOST             Server host
  OPENCODE_PORT           OpenCode server port
  OPENCODE_HOSTNAME       OpenCode server hostname
  OPENCODE_MODEL          OpenCode model (format: provider/model)
  LOG_LEVEL               Log level
  ILINK_BASE_URL          iLink API base URL
  BOT_TOKEN_PATH          Path to bot token file
  SESSION_DB_PATH         Path to session database file
`.trim();

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse CLI arguments from process.argv (or a custom array for testing).
 *
 * Returns a ParsedArgs object on success, or a ParseError on failure.
 * Does NOT call process.exit — the caller decides how to handle errors.
 */
export function parseArgs(argv: string[]): ParsedArgs | ParseError {
  const args: ParsedArgs = {};

  // Skip node binary and script path
  const tokens = argv.slice(2);
  let i = 0;

  // Check for subcommand first
  if (tokens.length > 0 && !tokens[0].startsWith("-")) {
    const cmd = tokens[0];
    if (cmd === "auth") {
      args.command = "auth";
      i = 1;
    } else {
      return {
        message: `Unknown subcommand: ${cmd}\n\n${HELP_TEXT}`,
        exitCode: 1,
      };
    }
  }

  while (i < tokens.length) {
    const token = tokens[i];

    switch (token) {
      case "--help":
      case "-h":
        args.help = true;
        i++;
        break;

      case "--version":
      case "-v":
        args.version = true;
        i++;
        break;

      case "--port": {
        const value = tokens[i + 1];
        if (!value || value.startsWith("-")) {
          return {
            message: `Error: --port requires a number\n\n${HELP_TEXT}`,
            exitCode: 1,
          };
        }
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return {
            message: `Error: --port must be a number between 1 and 65535, got: ${value}\n\n${HELP_TEXT}`,
            exitCode: 1,
          };
        }
        args.port = port;
        i += 2;
        break;
      }

      case "--host": {
        const value = tokens[i + 1];
        if (!value || value.startsWith("-")) {
          return {
            message: `Error: --host requires a string\n\n${HELP_TEXT}`,
            exitCode: 1,
          };
        }
        args.host = value;
        i += 2;
        break;
      }

      case "--opencode-port": {
        const value = tokens[i + 1];
        if (!value || value.startsWith("-")) {
          return {
            message: `Error: --opencode-port requires a number\n\n${HELP_TEXT}`,
            exitCode: 1,
          };
        }
        const port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          return {
            message: `Error: --opencode-port must be a number between 1 and 65535, got: ${value}\n\n${HELP_TEXT}`,
            exitCode: 1,
          };
        }
        args.opencodePort = port;
        i += 2;
        break;
      }

      case "--log-level": {
        const value = tokens[i + 1];
        if (!value || value.startsWith("-")) {
          return {
            message: `Error: --log-level requires a string\n\n${HELP_TEXT}`,
            exitCode: 1,
          };
        }
        const validLevels = ["debug", "info", "warn", "error"];
        if (!validLevels.includes(value)) {
          return {
            message: `Error: --log-level must be one of: ${validLevels.join(", ")}, got: ${value}\n\n${HELP_TEXT}`,
            exitCode: 1,
          };
        }
        args.logLevel = value;
        i += 2;
        break;
      }

      case "--daemon":
        args.daemon = true;
        i++;
        break;

      default:
        return {
          message: `Error: Unknown option: ${token}\n\n${HELP_TEXT}`,
          exitCode: 1,
        };
    }
  }

  return args;
}

/**
 * Get the help text string.
 */
export function getHelpText(): string {
  return HELP_TEXT;
}

/**
 * Get the version from package.json.
 * Uses dynamic import for ESM compatibility.
 */
let _cachedVersion: string | undefined;

export async function getVersion(): Promise<string> {
  if (_cachedVersion) return _cachedVersion;
  try {
    // Dynamic import for ESM compatibility
    const pkg = await import("../package.json");
    _cachedVersion = (pkg as any).default?.version ?? (pkg as any).version ?? "0.1.0";
  } catch {
    // Fallback: try require for CJS environments
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pkg = require("../package.json") as { version: string };
      _cachedVersion = pkg.version;
    } catch {
      _cachedVersion = "0.1.0";
    }
  }
return _cachedVersion!;
}