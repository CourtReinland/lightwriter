import { describe, expect, it, vi } from "vitest";
import { GrokService } from "../src/services/grokService";

describe("GrokService", () => {
  it("aborts completion requests and reports a timeout instead of hanging forever", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = new GrokService("xai-key");
    const completion = service.complete("system", "user", { timeoutMs: 25 });
    const expectedTimeout = expect(completion).rejects.toThrow("Grok API timed out after 25ms");

    await vi.advanceTimersByTimeAsync(25);
    await expectedTimeout;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);

    vi.useRealTimers();
  });
});
