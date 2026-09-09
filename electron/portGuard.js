/**
 * SuperK — Pre-flight Port Collision Detection & User Guidance (Ticket 03)
 *
 * Responsibilities:
 *  - Checks whether loopback ports (3000, 8765) are available before launching services
 *  - Provides human-readable diagnostic messages for port conflicts
 *  - Never terminates a process based on port occupancy alone
 *  - Prompts native dialog with [Retry Port Check] or [Exit]
 */

const net = require("net");

const PORT_DIAGNOSTICS = {
  3000: {
    serviceName: "Next.js Workspace Server",
    message:
      "Port 3000 is already in use. Another instance of SuperK or a Next.js dev server is running.",
  },
  8765: {
    serviceName: "Python Neural Cleaner & OCR Service",
    message:
      "Port 8765 is already in use. Another instance of the Python inpainting/OCR sidecar is running.",
  },
};

/**
 * Checks if a specific port is available on the given host.
 * @param {number} port
 * @param {string} host
 * @param {typeof net.createServer} [customCreateServer]
 * @returns {Promise<boolean>}
 */
function isPortAvailable(port, host = "127.0.0.1", customCreateServer = net.createServer) {
  return new Promise((resolve) => {
    const server = customCreateServer();

    server.once("error", (err) => {
      if (err.code === "EADDRINUSE" || err.code === "EACCES") {
        resolve(false);
      } else {
        resolve(false);
      }
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    try {
      server.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/**
 * Checks a list of ports and returns the first occupied port info, or null if all are free.
 * @param {number[]} ports
 * @param {(port: number) => Promise<boolean>} [isPortFreeFn]
 * @returns {Promise<{port: number, diagnostic: object} | null>}
 */
async function checkRequiredPorts(ports = [3000, 8765], isPortFreeFn = (p) => isPortAvailable(p)) {
  for (const port of ports) {
    const available = await isPortFreeFn(port);
    if (!available) {
      return {
        port,
        diagnostic: PORT_DIAGNOSTICS[port] || {
          serviceName: `Port ${port}`,
          message: `Port ${port} is already in use by another process.`,
        },
      };
    }
  }
  return null;
}

/**
 * Shows native confirmation dialog for an unknown port owner.
 * The user must close the unrelated program themselves; SuperK never kills a
 * process solely because it owns a required port.
 * @param {import('electron').Dialog} dialog
 * @param {import('electron').App} app
 * @param {{port: number, diagnostic: object}} conflict
 * @returns {Promise<boolean>} returns true to re-check the port, false if exiting
 */
async function promptPortConflict(dialog, app, conflict) {
  const choice = await dialog.showMessageBox({
    type: "warning",
    title: "SuperK — Port Conflict Detected",
    message: conflict.diagnostic.message,
    detail:
      "SuperK could not prove that the process using this port belongs to SuperK. Close the other program, then retry the port check, or exit SuperK.",
    buttons: ["Retry Port Check", "Exit SuperK"],
    defaultId: 0,
    cancelId: 1,
  });

  if (choice.response === 0) {
    await new Promise((r) => setTimeout(r, 300));
    return true;
  }

  app.quit();
  return false;
}

module.exports = {
  isPortAvailable,
  checkRequiredPorts,
  promptPortConflict,
  PORT_DIAGNOSTICS,
};
