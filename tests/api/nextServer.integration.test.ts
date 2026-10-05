// @vitest-environment node
// Integration tests over the REAL Next server (ticket 01 harness): some
// review findings live in the router's own behavior — path-segment decoding,
// Host/Origin handling — which direct handler invocation cannot exercise.
import { afterAll, beforeAll, expect, test } from "vitest";

import { createPageTargetIdentity } from "@/lib/extension/strictParity";
import { withReviewIdentity } from "@/lib/translation/qualityReview";
import {
  inspectedBackgroundEvidence,
  TEST_CLEAN_DATA_URL,
} from "../helpers/extensionBackgroundEvidence";

import {
  rawRequest,
  startNextTestServer,
  startSidecarStub,
  type NextTestServer,
  type SidecarStub,
} from "./nextServerHarness";

let server: NextTestServer;
let sidecar: SidecarStub;

beforeAll(async () => {
  sidecar = await startSidecarStub();
  process.env.SUPERK_CLEANER_URL = sidecar.url;
  server = await startNextTestServer();
}, 240_000);

afterAll(async () => {
  await server?.close();
  await sidecar?.close();
  delete process.env.SUPERK_CLEANER_URL;
});

test(
  "harness boots the real Next router and reaches a route handler over HTTP",
  async () => {
    const res = await fetch(`${server.url}/api/extension/pair`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { pairingToken?: string };
    expect(data.pairingToken).toBeTruthy();
  },
  240_000,
);

test(
  "pairing endpoint refuses a DNS-rebound Host/Origin pair over real HTTP",
  async () => {
    // A page at attacker.test (rebound to 127.0.0.1) sends this exact pair:
    // the browser considers it same-origin, so the response is readable.
    const rebound = await rawRequest(server.port, "/api/extension/pair", {
      host: "attacker.test:3000",
      origin: "http://attacker.test:3000",
    });
    expect(rebound.status).toBe(403);

    // The app page's own origin still receives the pairing token.
    const legit = await fetch(`${server.url}/api/extension/pair`);
    expect(legit.status).toBe(200);
  },
  240_000,
);

test(
  "clean proxy forwards normal cleaning requests to the sidecar scope",
  async () => {
    if (server.reused) {
      // A reused dev server keeps its own SUPERK_CLEANER_URL, so the stub
      // cannot observe its forwarding; the traversal test below still runs.
      return;
    }
    const res = await fetch(`${server.url}/api/clean/v1/health`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok?: boolean; path?: string };
    expect(data.ok).toBe(true);
    expect(data.path).toBe("/v1/health");
  },
  240_000,
);

test(
  "clean proxy never lets dot-segments escape the /v1 scope over real HTTP",
  async () => {
    const before = sidecar.requestedPaths().length;

    const encodedDots = await fetch(`${server.url}/api/clean/v1/%2e%2e/admin`);
    expect(encodedDots.status).toBe(400);

    const outsideScope = await fetch(`${server.url}/api/clean/admin/health`);
    expect(outsideScope.status).toBe(400);

    if (server.reused) return;

    // Nothing outside /v1 ever reached the sidecar.
    const paths = sidecar.requestedPaths().slice(before);
    expect(paths.every((p) => p.startsWith("/v1/"))).toBe(true);
  },
  240_000,
);

test(
  "publish-back and workspace handoffs enforce the pairing token over real HTTP",
  async () => {
    // Without a token, every method of both routes refuses.
    const noTokenGet = await fetch(`${server.url}/api/extension/publish-back?since=0`);
    expect(noTokenGet.status).toBe(401);
    const noTokenPost = await fetch(`${server.url}/api/extension/publish-back`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pageUrl: "https://m.test/p.png", bubbles: [] }),
    });
    expect(noTokenPost.status).toBe(401);
    const noTokenHandoff = await fetch(`${server.url}/api/extension/workspace/append?id=hnd_x`);
    expect(noTokenHandoff.status).toBe(401);

    // Legit flow: pair first, then use the token end to end.
    const pair = await fetch(`${server.url}/api/extension/pair`);
    const { pairingToken } = (await pair.json()) as { pairingToken: string };
    const auth = { authorization: `Bearer ${pairingToken}` };

    // Publication now requires the full strict evidence contract (target
    // identity, source revision, background proof, contextual reviews).
    const sourceRevision = "a".repeat(64);
    const publish = await fetch(`${server.url}/api/extension/publish-back`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        pageUrl: "https://m.test/p.png",
        targetIdentity: createPageTargetIdentity("th"),
        sourceRevision,
        ...inspectedBackgroundEvidence(sourceRevision),
        cleanUrl: TEST_CLEAN_DATA_URL,
        bubbles: [{ t: "คำแปล", original_text: "source", box: [1, 2, 3, 4], translationReview: withReviewIdentity({ status: "ok", sourceText: "source", reviewedText: "คำแปล" }, "th", sourceRevision) }],
      }),
    });
    expect(publish.status).toBe(200);

    const sync = await fetch(`${server.url}/api/extension/publish-back?sinceSeq=0`, {
      headers: auth,
    });
    expect(sync.status).toBe(200);
    const syncData = (await sync.json()) as { updates: unknown[] };
    expect(syncData.updates.length).toBe(1);

    const handoff = await fetch(`${server.url}/api/extension/workspace/append`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ pageUrl: "https://m.test/p.png" }),
    });
    expect(handoff.status).toBe(200);
    const { handoffId } = (await handoff.json()) as { handoffId: string };

    const pulled = await fetch(
      `${server.url}/api/extension/workspace/append?id=${handoffId}`,
      { headers: auth },
    );
    expect(pulled.status).toBe(200);

    const wrongToken = await fetch(
      `${server.url}/api/extension/workspace/append?id=${handoffId}`,
      { headers: { authorization: "Bearer wrong" } },
    );
    expect(wrongToken.status).toBe(401);
  },
  240_000,
);
