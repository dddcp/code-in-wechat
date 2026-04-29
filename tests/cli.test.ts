/**
 * Tests for CLI argument parser.
 *
 * Uses Vitest 1.6 compatible API:
 * - vi.fn() for mocks (NOT vi.mocked())
 * - vi.advanceTimersByTime() (sync, NOT vi.advanceTimersByTimeAsync())
 * - Manual env cleanup
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseArgs, getHelpText, type ParsedArgs, type ParseError } from "@/cli";

// ---------------------------------------------------------------------------
// parseArgs — basic parsing
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  // Helper: simulate process.argv
  function argv(...args: string[]): string[] {
    return ["node", "code-in-wechat", ...args];
  }

  it("parses no arguments (default start)", () => {
    const result = parseArgs(argv());
    expect(result).toEqual<ParsedArgs>({});
  });

  it("parses --port with a number", () => {
    const result = parseArgs(argv("--port", "8080"));
    expect(result).toEqual<ParsedArgs>({ port: 8080 });
  });

  it("parses --host with a string", () => {
    const result = parseArgs(argv("--host", "0.0.0.0"));
    expect(result).toEqual<ParsedArgs>({ host: "0.0.0.0" });
  });

  it("parses --opencode-port with a number", () => {
    const result = parseArgs(argv("--opencode-port", "5000"));
    expect(result).toEqual<ParsedArgs>({ opencodePort: 5000 });
  });

  it("parses --log-level with a valid level", () => {
    const result = parseArgs(argv("--log-level", "debug"));
    expect(result).toEqual<ParsedArgs>({ logLevel: "debug" });
  });

  it("parses --daemon flag", () => {
    const result = parseArgs(argv("--daemon"));
    expect(result).toEqual<ParsedArgs>({ daemon: true });
  });

  it("parses multiple flags together", () => {
    const result = parseArgs(argv("--port", "9090", "--host", "0.0.0.0", "--daemon", "--log-level", "warn"));
    expect(result).toEqual<ParsedArgs>({
      port: 9090,
      host: "0.0.0.0",
      daemon: true,
      logLevel: "warn",
    });
  });

  it("parses all valid log levels", () => {
    for (const level of ["debug", "info", "warn", "error"]) {
      const result = parseArgs(argv("--log-level", level));
      expect(result).toEqual<ParsedArgs>({ logLevel: level });
    }
  });
});

// ---------------------------------------------------------------------------
// parseArgs — --help
// ---------------------------------------------------------------------------

describe("parseArgs --help", () => {
  function argv(...args: string[]): string[] {
    return ["node", "code-in-wechat", ...args];
  }

  it("parses --help flag", () => {
    const result = parseArgs(argv("--help"));
    expect(result).toEqual<ParsedArgs>({ help: true });
  });

  it("parses -h short flag", () => {
    const result = parseArgs(argv("-h"));
    expect(result).toEqual<ParsedArgs>({ help: true });
  });
});

// ---------------------------------------------------------------------------
// parseArgs — --version
// ---------------------------------------------------------------------------

describe("parseArgs --version", () => {
  function argv(...args: string[]): string[] {
    return ["node", "code-in-wechat", ...args];
  }

  it("parses --version flag", () => {
    const result = parseArgs(argv("--version"));
    expect(result).toEqual<ParsedArgs>({ version: true });
  });

  it("parses -v short flag", () => {
    const result = parseArgs(argv("-v"));
    expect(result).toEqual<ParsedArgs>({ version: true });
  });
});

// ---------------------------------------------------------------------------
// parseArgs — auth subcommand
// ---------------------------------------------------------------------------

describe("parseArgs auth subcommand", () => {
  function argv(...args: string[]): string[] {
    return ["node", "code-in-wechat", ...args];
  }

  it("parses auth subcommand", () => {
    const result = parseArgs(argv("auth"));
    expect(result).toEqual<ParsedArgs>({ command: "auth" });
  });

  it("parses auth subcommand with flags", () => {
    const result = parseArgs(argv("auth", "--log-level", "debug"));
    expect(result).toEqual<ParsedArgs>({ command: "auth", logLevel: "debug" });
  });

  it("parses auth subcommand with --port", () => {
    const result = parseArgs(argv("auth", "--port", "3001"));
    expect(result).toEqual<ParsedArgs>({ command: "auth", port: 3001 });
  });
});

// ---------------------------------------------------------------------------
// parseArgs — error cases
// ---------------------------------------------------------------------------

describe("parseArgs errors", () => {
  function argv(...args: string[]): string[] {
    return ["node", "code-in-wechat", ...args];
  }

  it("returns error for unknown subcommand", () => {
    const result = parseArgs(argv("unknown"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).exitCode).toBe(1);
    expect((result as ParseError).message).toContain("Unknown subcommand");
  });

  it("returns error for unknown flag", () => {
    const result = parseArgs(argv("--unknown-flag"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).exitCode).toBe(1);
    expect((result as ParseError).message).toContain("Unknown option");
  });

  it("returns error for --port without value", () => {
    const result = parseArgs(argv("--port"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--port requires a number");
  });

  it("returns error for --port with non-numeric value", () => {
    const result = parseArgs(argv("--port", "abc"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--port must be a number");
  });

  it("returns error for --port with out-of-range value", () => {
    const result = parseArgs(argv("--port", "99999"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--port must be a number");
  });

  it("returns error for --host without value", () => {
    const result = parseArgs(argv("--host"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--host requires a string");
  });

  it("returns error for --opencode-port without value", () => {
    const result = parseArgs(argv("--opencode-port"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--opencode-port requires a number");
  });

  it("returns error for --log-level without value", () => {
    const result = parseArgs(argv("--log-level"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--log-level requires a string");
  });

  it("returns error for invalid --log-level value", () => {
    const result = parseArgs(argv("--log-level", "verbose"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--log-level must be one of");
  });

  it("returns error when value looks like a flag", () => {
    const result = parseArgs(argv("--port", "--help"));
    expect("exitCode" in result).toBe(true);
    expect((result as ParseError).message).toContain("--port requires a number");
  });
});

// ---------------------------------------------------------------------------
// getHelpText
// ---------------------------------------------------------------------------

describe("getHelpText", () => {
  it("returns a non-empty string", () => {
    const text = getHelpText();
    expect(text).toBeTruthy();
    expect(text.length).toBeGreaterThan(0);
  });

  it("contains usage information", () => {
    const text = getHelpText();
    expect(text).toContain("code-in-wechat");
    expect(text).toContain("--port");
    expect(text).toContain("--host");
    expect(text).toContain("--daemon");
    expect(text).toContain("--help");
    expect(text).toContain("--version");
  });

  it("contains auth subcommand info", () => {
    const text = getHelpText();
    expect(text).toContain("auth");
  });
});