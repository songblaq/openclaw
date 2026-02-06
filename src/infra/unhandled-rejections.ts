import process from "node:process";
import { extractErrorCode, formatUncaughtError } from "./errors.js";

type UnhandledRejectionHandler = (reason: unknown) => boolean;

const handlers = new Set<UnhandledRejectionHandler>();

const FATAL_ERROR_CODES = new Set([
  "ERR_OUT_OF_MEMORY",
  "ERR_SCRIPT_EXECUTION_TIMEOUT",
  "ERR_WORKER_OUT_OF_MEMORY",
  "ERR_WORKER_UNCAUGHT_EXCEPTION",
  "ERR_WORKER_INITIALIZATION_FAILED",
]);

const CONFIG_ERROR_CODES = new Set(["INVALID_CONFIG", "MISSING_API_KEY", "MISSING_CREDENTIALS"]);

// Network error codes that indicate transient failures (shouldn't crash the gateway)
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "ECONNABORTED",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_DNS_RESOLVE_FAILED",
  "UND_ERR_CONNECT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

// Rate limit error patterns that indicate transient failures (shouldn't crash the gateway)
const RATE_LIMIT_PATTERNS = [
  /rate[_ ]?limit/i,
  /too many requests/i,
  /429/,
  /quota/i, // matches "quota exceeded", "exceeded your current quota", etc.
  /resource[_ ]?exhausted/i,
  /overloaded/i,
];

function getErrorCause(err: unknown): unknown {
  if (!err || typeof err !== "object") {
    return undefined;
  }
  return (err as { cause?: unknown }).cause;
}

function extractErrorCodeWithCause(err: unknown): string | undefined {
  const direct = extractErrorCode(err);
  if (direct) {
    return direct;
  }
  return extractErrorCode(getErrorCause(err));
}

/**
 * Checks if an error is an AbortError.
 * These are typically intentional cancellations (e.g., during shutdown) and shouldn't crash.
 */
export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const name = "name" in err ? String(err.name) : "";
  if (name === "AbortError") {
    return true;
  }
  // Check for "This operation was aborted" message from Node's undici
  const message = "message" in err && typeof err.message === "string" ? err.message : "";
  if (message === "This operation was aborted") {
    return true;
  }
  return false;
}

function isFatalError(err: unknown): boolean {
  const code = extractErrorCodeWithCause(err);
  return code !== undefined && FATAL_ERROR_CODES.has(code);
}

function isConfigError(err: unknown): boolean {
  const code = extractErrorCodeWithCause(err);
  return code !== undefined && CONFIG_ERROR_CODES.has(code);
}

/**
 * Checks if an error is a transient network error that shouldn't crash the gateway.
 * These are typically temporary connectivity issues that will resolve on their own.
 */
/**
 * Checks if an error is a rate limit error that shouldn't crash the gateway.
 * These are temporary API limits that should be handled gracefully.
 */
export function isRateLimitError(err: unknown): boolean {
  if (!err) {
    return false;
  }

  // Check status code
  if (typeof err === "object" && err !== null) {
    const status = (err as { status?: unknown; statusCode?: unknown }).status ??
                   (err as { statusCode?: unknown }).statusCode;
    if (status === 429 || status === "429") {
      return true;
    }
  }

  // Check error message against rate limit patterns
  const message = err instanceof Error ? err.message : String(err);
  if (RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message))) {
    return true;
  }

  // Check the cause chain recursively
  const cause = getErrorCause(err);
  if (cause && cause !== err) {
    return isRateLimitError(cause);
  }

  return false;
}

export function isTransientNetworkError(err: unknown): boolean {
  if (!err) {
    return false;
  }

  const code = extractErrorCodeWithCause(err);
  if (code && TRANSIENT_NETWORK_CODES.has(code)) {
    return true;
  }

  // "fetch failed" TypeError from undici (Node's native fetch)
  if (err instanceof TypeError && err.message === "fetch failed") {
    const cause = getErrorCause(err);
    if (cause) {
      return isTransientNetworkError(cause);
    }
    return true;
  }

  // Check the cause chain recursively
  const cause = getErrorCause(err);
  if (cause && cause !== err) {
    return isTransientNetworkError(cause);
  }

  // AggregateError may wrap multiple causes
  if (err instanceof AggregateError && err.errors?.length) {
    return err.errors.some((e) => isTransientNetworkError(e));
  }

  return false;
}

export function registerUnhandledRejectionHandler(handler: UnhandledRejectionHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function isUnhandledRejectionHandled(reason: unknown): boolean {
  for (const handler of handlers) {
    try {
      if (handler(reason)) {
        return true;
      }
    } catch (err) {
      console.error(
        "[openclaw] Unhandled rejection handler failed:",
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
    }
  }
  return false;
}

export function installUnhandledRejectionHandler(): void {
  process.on("unhandledRejection", (reason, _promise) => {
    if (isUnhandledRejectionHandled(reason)) {
      return;
    }

    // AbortError is typically an intentional cancellation (e.g., during shutdown)
    // Log it but don't crash - these are expected during graceful shutdown
    if (isAbortError(reason)) {
      console.warn("[openclaw] Suppressed AbortError:", formatUncaughtError(reason));
      return;
    }

    if (isFatalError(reason)) {
      console.error("[openclaw] FATAL unhandled rejection:", formatUncaughtError(reason));
      process.exit(1);
      return;
    }

    if (isConfigError(reason)) {
      console.error("[openclaw] CONFIGURATION ERROR - requires fix:", formatUncaughtError(reason));
      process.exit(1);
      return;
    }

    if (isTransientNetworkError(reason)) {
      console.warn(
        "[openclaw] Non-fatal unhandled rejection (continuing):",
        formatUncaughtError(reason),
      );
      return;
    }

    // Rate limit errors are transient - log and continue instead of crashing
    // The fallback system should handle these, but if they escape, don't crash
    if (isRateLimitError(reason)) {
      console.warn(
        "[openclaw] Rate limit error (continuing, fallback should handle):",
        formatUncaughtError(reason),
      );
      return;
    }

    console.error("[openclaw] Unhandled promise rejection:", formatUncaughtError(reason));
    process.exit(1);
  });
}
