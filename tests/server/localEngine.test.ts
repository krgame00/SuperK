import { describe, expect, it, vi } from "vitest";

import { probeLocalEngine } from "@/lib/server/localEngine";

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

describe("probeLocalEngine", () => {
  it("GETs the normalized /v1/models URL and reports models on success", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ object: "list", data: [{ id: "qwen2.5-vl:7b" }, { id: "gemma3:12b" }] }),
    );

    const result = await probeLocalEngine({ baseUrl: "http://localhost:11434", fetchImpl });

    expect(result).toEqual({
      ok: true,
      baseUrl: "http://localhost:11434/v1",
      models: [{ id: "qwen2.5-vl:7b" }, { id: "gemma3:12b" }],
      latencyMs: expect.any(Number),
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("http://localhost:11434/v1/models");
    expect(init?.method).toBe("GET");
    expect(init?.cache).toBe("no-store");
  });

  it("allows an empty model list: daemon up, no models pulled", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: [] }));

    const result = await probeLocalEngine({ baseUrl: "http://localhost:11434/", fetchImpl });

    expect(result).toMatchObject({ ok: true, baseUrl: "http://localhost:11434/v1", models: [] });
  });

  it("reports unreachable on connection refused", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("fetch failed"));

    const result = await probeLocalEngine({ baseUrl: "http://localhost:11434", fetchImpl });

    expect(result).toMatchObject({
      ok: false,
      baseUrl: "http://localhost:11434/v1",
      code: "LOCAL_UNREACHABLE",
    });
    expect(result.ok === false && result.error).toContain("Could not reach the local engine");
  });

  it("reports unreachable when the daemon does not answer before the deadline", async () => {
    const hungFetch: typeof fetch = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      });

    const result = await probeLocalEngine({ baseUrl: "http://localhost:11434", timeoutMs: 10, fetchImpl: hungFetch });

    expect(result).toMatchObject({ ok: false, code: "LOCAL_UNREACHABLE" });
    expect(result.ok === false && result.error).toContain("Could not reach the local engine");
  });

  it("reports bad response with the upstream status on non-2xx", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ error: "boom" }, 500));

    const result = await probeLocalEngine({ baseUrl: "http://localhost:11434", fetchImpl });

    expect(result).toMatchObject({ ok: false, code: "LOCAL_BAD_RESPONSE" });
    expect(result.ok === false && result.error).toContain("500");
  });

  it("reports bad response when a 2xx body is not the { data: [{ id }] } shape", async () => {
    const wrongShape = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ models: ["m1"] }));
    await expect(probeLocalEngine({ baseUrl: "http://localhost:11434", fetchImpl: wrongShape })).resolves.toMatchObject({
      ok: false,
      code: "LOCAL_BAD_RESPONSE",
    });

    const invalidJson = vi.fn<typeof fetch>().mockResolvedValue(new Response("{not json", { status: 200 }));
    await expect(probeLocalEngine({ baseUrl: "http://localhost:11434", fetchImpl: invalidJson })).resolves.toMatchObject({
      ok: false,
      code: "LOCAL_BAD_RESPONSE",
    });
  });

  it("answers bad response without any fetch when the base URL is unusable", async () => {
    const fetchImpl = vi.fn<typeof fetch>();

    const result = await probeLocalEngine({ baseUrl: "not a url", fetchImpl });

    expect(result).toMatchObject({ ok: false, code: "LOCAL_BAD_RESPONSE", baseUrl: "" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
