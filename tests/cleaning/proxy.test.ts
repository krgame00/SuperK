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
