export const logger = {
  info(message: string, data?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: "info", message, ...data }));
  },
  warn(message: string, data?: Record<string, unknown>): void {
    console.warn(JSON.stringify({ level: "warn", message, ...data }));
  },
  error(message: string, data?: Record<string, unknown>): void {
    console.error(JSON.stringify({ level: "error", message, ...data }));
  }
};
