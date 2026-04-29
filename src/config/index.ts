import dotenv from "dotenv";
import { appConfigSchema, type AppConfig } from "./env.js";

dotenv.config();

export function loadConfig(): AppConfig {
  return appConfigSchema.parse({
    ilink: {
      base_url: process.env.ILINK_BASE_URL,
      bot_token_path: process.env.BOT_TOKEN_PATH,
    },
    opencode: {
      port: process.env.OPENCODE_PORT,
      hostname: process.env.OPENCODE_HOSTNAME,
      model: process.env.OPENCODE_MODEL,
    },
    server: {
      port: process.env.SERVER_PORT,
      host: process.env.SERVER_HOST,
    },
    logging: {
      level: process.env.LOG_LEVEL,
    },
    session_db_path: process.env.SESSION_DB_PATH,
  });
}

export type { AppConfig };
