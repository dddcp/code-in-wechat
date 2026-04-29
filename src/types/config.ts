/**
 * Application configuration types
 */

// ---------------------------------------------------------------------------
// Sub-configs
// ---------------------------------------------------------------------------

export interface iLinkConfig {
  base_url: string;
  bot_token_path: string;
}

export interface OpenCodeConfig {
  port: number;
  hostname: string;
  model: string;
  directory?: string;
}

export interface ServerConfig {
  port: number;
  host: string;
}

export interface LoggingConfig {
  level: string;
}

// ---------------------------------------------------------------------------
// Root config
// ---------------------------------------------------------------------------

export interface AppConfig {
  ilink: iLinkConfig;
  opencode: OpenCodeConfig;
  server: ServerConfig;
  logging: LoggingConfig;
}
