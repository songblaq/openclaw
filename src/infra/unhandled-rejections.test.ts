import { describe, expect, it } from "vitest";
import { isAbortError, isRateLimitError, isTransientNetworkError } from "./unhandled-rejections.js";

describe("isAbortError", () => {
  it("returns true for error with name AbortError", () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    expect(isAbortError(error)).toBe(true);
  });

  it('returns true for error with "This operation was aborted" message', () => {
    const error = new Error("This operation was aborted");
    expect(isAbortError(error)).toBe(true);
  });

  it("returns true for undici-style AbortError", () => {
    // Node's undici throws errors with this exact message
    const error = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(isAbortError(error)).toBe(true);
  });

  it("returns true for object with AbortError name", () => {
    expect(isAbortError({ name: "AbortError", message: "test" })).toBe(true);
  });

  it("returns false for regular errors", () => {
    expect(isAbortError(new Error("Something went wrong"))).toBe(false);
    expect(isAbortError(new TypeError("Cannot read property"))).toBe(false);
    expect(isAbortError(new RangeError("Invalid array length"))).toBe(false);
  });

  it("returns false for errors with similar but different messages", () => {
    expect(isAbortError(new Error("Operation aborted"))).toBe(false);
    expect(isAbortError(new Error("aborted"))).toBe(false);
    expect(isAbortError(new Error("Request was aborted"))).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isAbortError("string error")).toBe(false);
    expect(isAbortError(42)).toBe(false);
  });

  it("returns false for plain objects without AbortError name", () => {
    expect(isAbortError({ message: "plain object" })).toBe(false);
  });
});

describe("isTransientNetworkError", () => {
  it("returns true for errors with transient network codes", () => {
    const codes = [
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
      "UND_ERR_SOCKET",
      "UND_ERR_HEADERS_TIMEOUT",
      "UND_ERR_BODY_TIMEOUT",
    ];

    for (const code of codes) {
      const error = Object.assign(new Error("test"), { code });
      expect(isTransientNetworkError(error), `code: ${code}`).toBe(true);
    }
  });

  it('returns true for TypeError with "fetch failed" message', () => {
    const error = new TypeError("fetch failed");
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for fetch failed with network cause", () => {
    const cause = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    const error = Object.assign(new TypeError("fetch failed"), { cause });
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for nested cause chain with network error", () => {
    const innerCause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const outerCause = Object.assign(new Error("wrapper"), { cause: innerCause });
    const error = Object.assign(new TypeError("fetch failed"), { cause: outerCause });
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns true for AggregateError containing network errors", () => {
    const networkError = Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
    const error = new AggregateError([networkError], "Multiple errors");
    expect(isTransientNetworkError(error)).toBe(true);
  });

  it("returns false for regular errors without network codes", () => {
    expect(isTransientNetworkError(new Error("Something went wrong"))).toBe(false);
    expect(isTransientNetworkError(new TypeError("Cannot read property"))).toBe(false);
    expect(isTransientNetworkError(new RangeError("Invalid array length"))).toBe(false);
  });

  it("returns false for errors with non-network codes", () => {
    const error = Object.assign(new Error("test"), { code: "INVALID_CONFIG" });
    expect(isTransientNetworkError(error)).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isTransientNetworkError(null)).toBe(false);
    expect(isTransientNetworkError(undefined)).toBe(false);
  });

  it("returns false for non-error values", () => {
    expect(isTransientNetworkError("string error")).toBe(false);
    expect(isTransientNetworkError(42)).toBe(false);
    expect(isTransientNetworkError({ message: "plain object" })).toBe(false);
  });

  it("returns false for AggregateError with only non-network errors", () => {
    const error = new AggregateError([new Error("regular error")], "Multiple errors");
    expect(isTransientNetworkError(error)).toBe(false);
  });
});

describe("isRateLimitError", () => {
  it("returns true for error with status 429", () => {
    const error = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(isRateLimitError(error)).toBe(true);
  });

  it("returns true for error with statusCode 429", () => {
    const error = Object.assign(new Error("Too Many Requests"), { statusCode: 429 });
    expect(isRateLimitError(error)).toBe(true);
  });

  it("returns true for error with status string '429'", () => {
    const error = Object.assign(new Error("Too Many Requests"), { status: "429" });
    expect(isRateLimitError(error)).toBe(true);
  });

  it("returns true for error message containing rate_limit", () => {
    expect(isRateLimitError(new Error("rate_limit_error: Your account has hit a rate limit"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("Rate Limit Exceeded"))).toBe(true);
  });

  it("returns true for error message containing too many requests", () => {
    expect(isRateLimitError(new Error("Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("too many requests - please slow down"))).toBe(true);
  });

  it("returns true for error message containing quota exceeded", () => {
    expect(isRateLimitError(new Error("You have exceeded your current quota"))).toBe(true);
    expect(isRateLimitError(new Error("Quota exceeded for this resource"))).toBe(true);
  });

  it("returns true for error message containing resource_exhausted", () => {
    expect(isRateLimitError(new Error("resource_exhausted: API rate limit"))).toBe(true);
    expect(isRateLimitError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
  });

  it("returns true for error message containing overloaded", () => {
    expect(isRateLimitError(new Error("overloaded_error: Server is overloaded"))).toBe(true);
    expect(isRateLimitError(new Error("The server is overloaded"))).toBe(true);
  });

  it("returns true for nested cause with rate limit error", () => {
    const cause = Object.assign(new Error("rate limit hit"), { status: 429 });
    const error = Object.assign(new Error("Request failed"), { cause });
    expect(isRateLimitError(error)).toBe(true);
  });

  it("returns false for regular errors without rate limit indicators", () => {
    expect(isRateLimitError(new Error("Something went wrong"))).toBe(false);
    expect(isRateLimitError(new Error("Internal server error"))).toBe(false);
    expect(isRateLimitError(new Error("Bad request"))).toBe(false);
  });

  it("returns false for network errors", () => {
    const error = Object.assign(new Error("Connection reset"), { code: "ECONNRESET" });
    expect(isRateLimitError(error)).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });

  it("returns false for other status codes", () => {
    expect(isRateLimitError(Object.assign(new Error("Not Found"), { status: 404 }))).toBe(false);
    expect(isRateLimitError(Object.assign(new Error("Server Error"), { status: 500 }))).toBe(false);
    expect(isRateLimitError(Object.assign(new Error("Unauthorized"), { status: 401 }))).toBe(false);
  });
});
