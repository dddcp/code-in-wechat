export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: LogLevel[] = ["debug", "info", "warn", "error"];

let globalLogLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) ?? "info";

export function setLogLevel(level: LogLevel): void {
  globalLogLevel = level;
}

export function mask(value: string): string {
  if (value.length <= 4) return "****";
  return `***${value.slice(-4)}`;
}

function isLogLevelEnabled(level: LogLevel): boolean {
  return LEVELS.indexOf(level) >= LEVELS.indexOf(globalLogLevel);
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (
      typeof value === "string" &&
      /token|secret|password|key/i.test(key)
    ) {
      masked[key] = mask(value);
    } else {
      masked[key] = value;
    }
  }
  return ` ${JSON.stringify(masked)}`;
}

export function createLogger(module: string) {
  function log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!isLogLevelEnabled(level)) return;
    const timestamp = new Date().toISOString();
    const metaStr = formatMeta(meta);
    const output = `[${timestamp}] [${level.toUpperCase()}] [${module}] ${message}${metaStr}`;
    if (level === "error") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  return {
    debug: (message: string, meta?: Record<string, unknown>) => log("debug", message, meta),
    info: (message: string, meta?: Record<string, unknown>) => log("info", message, meta),
    warn: (message: string, meta?: Record<string, unknown>) => log("warn", message, meta),
    error: (message: string, meta?: Record<string, unknown>) => log("error", message, meta),
  };
}
