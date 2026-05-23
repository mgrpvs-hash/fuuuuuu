import { randomUUID } from "node:crypto";

import { env } from "../config/env.js";

type LogLevel = "fatal" | "error" | "warn" | "info" | "debug" | "trace";

const LOG_ORDER: Record<LogLevel, number> = {
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10
};

const redactKeys = new Set(["access_token", "token", "authorization", "apiKey", "openai_api_key"]);

function shouldLog(level: LogLevel): boolean {
  return LOG_ORDER[level] >= LOG_ORDER[env.LOG_LEVEL];
}

function redact(data: unknown): unknown {
  if (!data || typeof data !== "object") {
    return data;
  }
  if (Array.isArray(data)) {
    return data.map((item) => redact(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (redactKeys.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
      continue;
    }
    result[key] = redact(value);
  }
  return result;
}

function writeLog(level: LogLevel, message: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) {
    return;
  }

  const sanitizedData = redact(data ?? {});
  const payload =
    sanitizedData && typeof sanitizedData === "object" && !Array.isArray(sanitizedData)
      ? (sanitizedData as Record<string, unknown>)
      : { data: sanitizedData };

  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...payload
  };
  const serialized = JSON.stringify(line);

  if (level === "error" || level === "fatal") {
    console.error(serialized);
    return;
  }
  if (level === "warn") {
    console.warn(serialized);
    return;
  }
  console.log(serialized);
}

export const logger = {
  trace(message: string, data?: Record<string, unknown>): void {
    writeLog("trace", message, data);
  },
  debug(message: string, data?: Record<string, unknown>): void {
    writeLog("debug", message, data);
  },
  info(message: string, data?: Record<string, unknown>): void {
    writeLog("info", message, data);
  },
  warn(message: string, data?: Record<string, unknown>): void {
    writeLog("warn", message, data);
  },
  error(message: string, data?: Record<string, unknown>): void {
    writeLog("error", message, data);
  },
  child(context: Record<string, unknown>) {
    return {
      trace: (message: string, data?: Record<string, unknown>) =>
        writeLog("trace", message, { ...context, ...data }),
      debug: (message: string, data?: Record<string, unknown>) =>
        writeLog("debug", message, { ...context, ...data }),
      info: (message: string, data?: Record<string, unknown>) =>
        writeLog("info", message, { ...context, ...data }),
      warn: (message: string, data?: Record<string, unknown>) =>
        writeLog("warn", message, { ...context, ...data }),
      error: (message: string, data?: Record<string, unknown>) =>
        writeLog("error", message, { ...context, ...data })
    };
  },
  newCorrelationId(): string {
    return randomUUID();
  }
};
