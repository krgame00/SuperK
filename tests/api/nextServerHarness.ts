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
}

// Boots the real Next.js server (real router: path decoding, Host/Origin
// handling) on an ephemeral loopback port. The server runs in a child process
// because loading Next's native modules inside the vitest worker segfaults
// Node on Windows during teardown.
export async function startNextTestServer(): Promise<NextTestServer> {
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
