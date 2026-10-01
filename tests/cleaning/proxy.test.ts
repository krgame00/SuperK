import { beforeEach, expect, test, vi } from "vitest";

import {
  GET,
  MAX_PROXY_BODY_BYTES,
  POST,
} from "@/src/app/api/clean/[...path]/route";

beforeEach(() => {
  vi.restoreAllMocks();
  delete process.env.SUPERK_CLEANER_URL;
});

test("rejects an external multipart request before invoking the cleaner", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
  const response = await POST(new Request("http://localhost/api/clean/v1/jobs", {
    method: "POST", headers: { origin: "https://external.invalid", "content-type": "multipart/form-data; boundary=audit" }, body: "--audit--",
  }), { params: Promise.resolve({ path: ["v1", "jobs"] }) });
  expect(response.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

test.each(["http://localhost:3000", "http://127.0.0.1:3000", "chrome-extension://test-extension"])("accepts a local/extension cleaner origin: %s", async (origin) => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ ok: true }));
  const response = await POST(new Request("http://localhost/api/clean/v1/jobs", {
    method: "POST", headers: { origin }, body: "test",
  }), { params: Promise.resolve({ path: ["v1", "jobs"] }) });
  expect(response.status).toBe(200);
  expect(fetchMock).toHaveBeenCalledOnce();
});

test.each(["null", "file://localhost", "http://localhost.evil.invalid", "invalid-origin"])("rejects an untrusted cleaner origin: %s", async (origin) => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const response = await POST(new Request("http://localhost/api/clean/v1/jobs", { method: "POST", headers: { origin } }), { params: Promise.resolve({ path: ["v1", "jobs"] }) });
  expect(response.status).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("GET forwards path and query to the local cleaner", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("png", {
      status: 200,
      headers: { "content-type": "image/png" },
    }),
  );
  const response = await GET(
    new Request("http://localhost/api/clean/v1/jobs/job-1?fresh=1"),
    { params: Promise.resolve({ path: ["v1", "jobs", "job-1"] }) },
  );
  expect(fetchMock.mock.calls[0][0]).toBe(
    "http://127.0.0.1:8765/v1/jobs/job-1?fresh=1",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});

test("rejects dot-segment paths instead of forwarding them", async () => {
  const response = await GET(
    new Request("http://localhost/api/clean/v1/%2e%2e/admin"),
    { params: Promise.resolve({ path: ["v1", "..", "admin"] }) },
  );
  expect(response.status).toBe(400);
});

test("rejects paths outside the /v1 scope", async () => {
  const response = await GET(
    new Request("http://localhost/api/clean/admin/health"),
    { params: Promise.resolve({ path: ["admin", "health"] }) },
  );
  expect(response.status).toBe(400);
});

test("POST forwards the original multipart bytes and content type", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json(
      { job_id: "job-1", status: "queued", stage: "queued" },
      { status: 202 },
    ),
  );
  const request = new Request("http://localhost/api/clean/v1/jobs", {
    method: "POST",
    body: new Uint8Array([1, 2, 3]),
    headers: { "content-type": "multipart/form-data; boundary=test" },
  });
  const response = await POST(request, {
    params: Promise.resolve({ path: ["v1", "jobs"] }),
  });
  const options = fetchMock.mock.calls[0][1];
  expect(new Uint8Array(options?.body as ArrayBuffer)).toEqual(
    new Uint8Array([1, 2, 3]),
  );
  expect((options?.headers as Headers).get("content-type")).toContain(
    "boundary=test",
  );
  expect(response.status).toBe(202);
});

test("POST rejects bodies over 80 MB before contacting the cleaner", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const request = new Request("http://localhost/api/clean/v1/jobs", {
    method: "POST",
    body: new Uint8Array([1]),
    headers: {
      "content-length": String(MAX_PROXY_BODY_BYTES + 1),
      "content-type": "multipart/form-data; boundary=test",
    },
  });
  const response = await POST(request, {
    params: Promise.resolve({ path: ["v1", "jobs"] }),
  });
  expect(response.status).toBe(413);
  expect(fetchMock).not.toHaveBeenCalled();
});
