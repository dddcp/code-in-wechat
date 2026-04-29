import { describe, test, expect, afterEach } from "vitest";
import type { AppConfig } from "@/config/index";

const ENV_KEYS = [
  "ILINK_BASE_URL",
  "BOT_TOKEN_PATH",
  "OPENCODE_PORT",
  "OPENCODE_HOSTNAME",
  "OPENCODE_MODEL",
  "SERVER_PORT",
  "SERVER_HOST",
  "LOG_LEVEL",
  "SESSION_DB_PATH",
];

describe("loadConfig", () => {
  afterEach(() => {
    // vi.unstubAllEnvs() is not available in Vitest 1.6, clean up manually
    for (const key of ENV_KEYS) {
      delete process.env[key];
    }
  });

test("valid config loads with defaults", async () => {
    process.env.SESSION_DB_PATH = "./session-db.json";

    const { loadConfig } = await import("@/config/index");
    // dotenv.config() runs on import and may set OPENCODE_MODEL from .env.
    // Clear it AFTER import so loadConfig() reads the cleared value.
    delete process.env.OPENCODE_MODEL;

    const config: AppConfig = loadConfig();

    expect(config.ilink.base_url).toBe("https://ilinkai.weixin.qq.com");
    expect(config.ilink.bot_token_path).toBe("./bot-token.json");
    expect(config.opencode.port).toBe(4096);
    expect(config.opencode.hostname).toBe("127.0.0.1");
    // model should be undefined when OPENCODE_MODEL env var is cleared
    expect(config.opencode.model).toBeUndefined();
    expect(config.server.port).toBe(3000);
    expect(config.server.host).toBe("localhost");
    expect(config.logging.level).toBe("info");
    expect(config.session_db_path).toBe("./session-db.json");
  });

  test("custom env vars override defaults", async () => {
    process.env.ILINK_BASE_URL = "https://custom.weixin.qq.com";
    process.env.BOT_TOKEN_PATH = "./custom-token.json";
    process.env.OPENCODE_PORT = "5000";
    process.env.OPENCODE_HOSTNAME = "0.0.0.0";
    process.env.OPENCODE_MODEL = "gpt-4";
    process.env.SERVER_PORT = "8080";
    process.env.SERVER_HOST = "0.0.0.0";
    process.env.LOG_LEVEL = "debug";
    process.env.SESSION_DB_PATH = "./custom-db.json";

    const { loadConfig } = await import("@/config/index");
    const config: AppConfig = loadConfig();

    expect(config.ilink.base_url).toBe("https://custom.weixin.qq.com");
    expect(config.ilink.bot_token_path).toBe("./custom-token.json");
    expect(config.opencode.port).toBe(5000);
    expect(config.opencode.hostname).toBe("0.0.0.0");
    expect(config.opencode.model).toBe("gpt-4");
    expect(config.server.port).toBe(8080);
    expect(config.server.host).toBe("0.0.0.0");
    expect(config.logging.level).toBe("debug");
    expect(config.session_db_path).toBe("./custom-db.json");
  });

  test("missing required config throws ZodError", async () => {
    const { loadConfig } = await import("@/config/index");
    expect(() => loadConfig()).toThrow();
  });

  test("invalid values throw ZodError", async () => {
    process.env.SESSION_DB_PATH = "./session-db.json";
    process.env.OPENCODE_PORT = "not-a-number";

    const { loadConfig } = await import("@/config/index");
    expect(() => loadConfig()).toThrow();
  });
});
