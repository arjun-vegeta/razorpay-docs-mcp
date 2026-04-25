/**
 * Logger that writes to stderr. Stdout is reserved for MCP JSON-RPC.
 * See CLAUDE.md §5 — any stray stdout corrupts the protocol.
 */

export const LogLevel = {
  Error: 0,
  Warn: 1,
  Info: 2,
  Debug: 3,
} as const;
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

const LEVEL_FROM_ENV: Record<string, LogLevel> = {
  error: LogLevel.Error,
  warn: LogLevel.Warn,
  info: LogLevel.Info,
  debug: LogLevel.Debug,
};

const DEFAULT_LEVEL: LogLevel = LogLevel.Warn;

function currentLevel(): LogLevel {
  const raw = process.env["RZP_MCP_LOG_LEVEL"]?.toLowerCase();
  if (raw !== undefined && raw in LEVEL_FROM_ENV) {
    return LEVEL_FROM_ENV[raw] ?? DEFAULT_LEVEL;
  }
  return DEFAULT_LEVEL;
}

function emit(level: LogLevel, label: string, args: readonly unknown[]): void {
  if (level > currentLevel()) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] [${label}] ${args.map(stringify).join(" ")}\n`;
  process.stderr.write(line);
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export const log = {
  error: (...args: readonly unknown[]): void => emit(LogLevel.Error, "error", args),
  warn: (...args: readonly unknown[]): void => emit(LogLevel.Warn, "warn", args),
  info: (...args: readonly unknown[]): void => emit(LogLevel.Info, "info", args),
  debug: (...args: readonly unknown[]): void => emit(LogLevel.Debug, "debug", args),
};
