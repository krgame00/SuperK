import { spawn, type ChildProcess } from "node:child_process";
import { createServer, request as httpRequest, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export interface NextTestServer {
  url: string;
  port: number;
  close: () => Promise<void>;
  /** True when an already-running dev server (e.g. the user's) is reused. */
  reused: boolean;
}

// Resolves the integration-test server: reuse an already-running dev server
// when one answers (Next 16 allows only one dev server per directory, so a
// user-launched `npm run dev` must not be fought over); otherwise boot a
// private child-process dev server. Override the target with
// SUPERK_TEST_SERVER_URL when the dev server runs on a non-default port.
export async function startNextTestServer(): Promise<NextTestServer> {
  const candidates = process.env.SUPERK_TEST_SERVER_URL
    ? [process.env.SUPERK_TEST_SERVER_URL, "http://127.0.0.1:3000"]
    : ["http://127.0.0.1:3000"];
  for (const candidate of candidates) {
    try {
      const probe = await fetch(`${candidate}/api/extension/pair`, {
        signal: AbortSignal.timeout(1500),
      });
      if (probe.ok) {
        return {
          url: candidate,
          port: Number(new URL(candidate).port) || 80,
          close: async () => {},
          reused: true,
        };
      }
    } catch {
      // Not running — try the next candidate.
    }
  }
  return spawnNextTestServer();
}

async function spawnNextTestServer(): Promise<NextTestServer> {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const childScript = path.join(repoRoot, "tests", "api", "nextServerChild.mjs");
  const child: ChildProcess = spawn(
    process.execPath,
    [childScript],
    { cwd: repoRoot, stdio: ["pipe", "pipe", "pipe", "ipc"] },
  );

  const port = await new Promise<number>((resolve, reject) => {
    let stdout = "";
    const timer = setTimeout(() => reject(new Error("Next test server did not become ready")), 240_000);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = /READY:(\d+)/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Next test server exited early with code ${code}`));
    });
  });

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    reused: false,
    close: async () => {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill();
          resolve();
        }, 10_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
        child.send("close");
      });
    },
  };
}

// Minimal stand-in for the Python sidecar: records every request path it is
// asked for so tests can assert what the proxy actually forwarded.
export interface SidecarStub {
  url: string;
  requestedPaths: () => string[];
  close: () => Promise<void>;
}

export async function startSidecarStub(): Promise<SidecarStub> {
  const requested: string[] = [];
  const server: Server = createServer((req, res) => {
    requested.push(req.url ?? "");
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, path: req.url ?? "" }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requestedPaths: () => [...requested],
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

// Node's fetch refuses to override the Host header; DNS-rebinding review
// cases need a raw request with an attacker-controlled Host/Origin pair.
export function rawRequest(
  port: number,
  requestPath: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, path: requestPath, method: "GET", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}
