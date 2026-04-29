import { z } from "zod";

export const iLinkConfigSchema = z.object({
  base_url: z
    .string()
    .min(1, "ILINK_BASE_URL is required when not using default")
    .default("https://ilinkai.weixin.qq.com"),
  bot_token_path: z
    .string()
    .min(1, "BOT_TOKEN_PATH is required when not using default")
    .default("./bot-token.json"),
});

export const openCodeConfigSchema = z.object({
  port: z.preprocess(
    (val) => (val === "" || val === undefined ? 4096 : val),
    z.coerce.number()
  ),
  hostname: z
    .string()
    .min(1, "OPENCODE_HOSTNAME is required when not using default")
    .default("127.0.0.1"),
  model: z.preprocess(
    (val) => (val === "" || val === undefined ? undefined : val),
    z.string().optional()
  ),
});

export const serverConfigSchema = z.object({
  port: z.preprocess(
    (val) => (val === "" || val === undefined ? 3000 : val),
    z.coerce.number()
  ),
  host: z
    .string()
    .min(1, "SERVER_HOST is required when not using default")
    .default("localhost"),
});

export const loggingConfigSchema = z.object({
  level: z.preprocess(
    (val) => (val === "" || val === undefined ? "info" : val),
    z.enum(["debug", "info", "warn", "error"])
  ),
});

export const appConfigSchema = z.object({
  ilink: iLinkConfigSchema,
  opencode: openCodeConfigSchema,
  server: serverConfigSchema,
  logging: loggingConfigSchema,
  session_db_path: z
    .string({
      required_error: "SESSION_DB_PATH is required",
    })
    .min(1, "SESSION_DB_PATH cannot be empty"),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
