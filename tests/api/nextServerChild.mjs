// Standalone Next dev server for the integration harness. Runs in its own
// process because loading Next's native modules inside the vitest worker
// segfaults Node on Windows during teardown; here any teardown damage is
// contained to this child, which the parent terminates anyway.
import { createServer } from "node:http";

const dir = process.cwd();
const { default: nextFactory } = await import("next");
const app = nextFactory({ dev: true, dir, hostname: "127.0.0.1" });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((req, res) => {
  handle(req, res);
});
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  process.stdout.write(`READY:${port}\n`);
});

process.on("message", (message) => {
  if (message !== "close") return;
  server.closeAllConnections();
  server.close(() => {});
  app
    .close()
    .catch(() => {})
    .finally(() => process.exit(0));
});
