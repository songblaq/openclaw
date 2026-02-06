/**
 * Rate Limit Fallback Tests
 * 
 * 이 테스트는 429 rate limit 에러 발생 시 fallback이 제대로 동작하는지 확인합니다.
 * Blaq의 분석: 기존 테스트에 rate limit(429) 테스트가 없었음!
 */
import { describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { runWithModelFallback } from "./model-fallback.js";

function makeCfg(overrides: Partial<OpenClawConfig> = {}): OpenClawConfig {
  return {
    agents: {
      defaults: {
        model: {
          primary: "anthropic/claude-opus-4-5",
          fallbacks: [
            "openrouter/anthropic/claude-sonnet-4",
            "lucablaq-studio-ollama/qwen3:32b",
          ],
        },
      },
    },
    ...overrides,
  } as OpenClawConfig;
}

describe("runWithModelFallback - Rate Limit Tests", () => {
  it("falls back on 429 status code", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Too Many Requests"), { status: 429 }))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-5",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });

  it("falls back on rate_limit_error type in message", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("rate_limit_error: Your account has hit a rate limit"))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-5",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });

  it("falls back on Anthropic-style rate limit error", async () => {
    const cfg = makeCfg();
    // Anthropic 실제 에러 형식 시뮬레이션
    const anthropicError = Object.assign(
      new Error('{"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}'),
      { status: 429 }
    );
    const run = vi
      .fn()
      .mockRejectedValueOnce(anthropicError)
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-5",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });

  it("falls back on quota exceeded message", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("You have exceeded your current quota"))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-5",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });

  it("falls back on resource_exhausted message (Google-style)", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("resource_exhausted: API rate limit exceeded"))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "google",
      model: "gemini-2.0-flash",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });

  it("falls back on overloaded_error", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error('{"type":"overloaded_error","message":"Server is overloaded"}'))
      .mockResolvedValueOnce("ok");

    const result = await runWithModelFallback({
      cfg,
      provider: "anthropic",
      model: "claude-opus-4-5",
      run,
    });

    expect(result.result).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
    // overloaded도 rate_limit으로 분류됨
    expect(result.attempts[0]?.reason).toBe("rate_limit");
  });

  it("does NOT fall back on generic errors without rate limit hints", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("Something went wrong"))
      .mockResolvedValueOnce("ok");

    await expect(
      runWithModelFallback({
        cfg,
        provider: "anthropic",
        model: "claude-opus-4-5",
        run,
      }),
    ).rejects.toThrow("Something went wrong");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("tries all fallbacks before giving up", async () => {
    const cfg = makeCfg();
    const run = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }));

    await expect(
      runWithModelFallback({
        cfg,
        provider: "anthropic",
        model: "claude-opus-4-5",
        run,
      }),
    ).rejects.toThrow("All models failed");
    expect(run).toHaveBeenCalledTimes(3);
  });
});
