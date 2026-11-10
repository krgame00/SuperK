/**
 * Local IPC Named Pipe Server for Visual Novel Memory Hooks
 *
 * Implements Section 4.3 of the SuperK Next-Gen Architectural Blueprint:
 * - High-speed Inter-Process Communication (Windows Named Pipe / POSIX Domain Socket).
 * - Zero OCR memory extraction direct from game engine process.
 * - Streams structured TextFrame payloads into MonotonicSlidingWindowDebounce.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Typed IPC connection lifecycle and protocol framing.
 * - principle-fix-root-causes: Replaces heavy screen OCR (850ms) with native memory pipe (<5ms).
 * - principle-laziness-protocol: Standard Node.js net module with zero external dependencies.
 */

import net from "net";
import os from "os";
import path from "path";
import { MonotonicSlidingWindowDebounce } from "./monotonicDebounce";
import { type DebounceOptions, type TextFrame, type VNEngineType } from "./types";

export interface VNPipeServerOptions extends DebounceOptions {
  /** Custom pipe name. Default: "superk_vn_hook" */
  pipeName?: string;
  /** Callback fired whenever a complete debounced dialogue frame is ready */
  onDialogueReady?: (frame: TextFrame) => void;
  /** Callback for server errors */
  onError?: (err: Error) => void;
}

export function getPlatformPipePath(pipeName = "superk_vn_hook"): string {
  if (os.platform() === "win32") {
    return `\\\\.\\pipe\\${pipeName}`;
  }
  return path.join(os.tmpdir(), `${pipeName}.sock`);
}

export class VNPipeServer {
  private readonly pipePath: string;
  private readonly debounce: MonotonicSlidingWindowDebounce;
  private server: net.Server | null = null;
  private isListening = false;
  private readonly onDialogueReady?: (frame: TextFrame) => void;
  private readonly onError?: (err: Error) => void;

  constructor(options?: VNPipeServerOptions) {
    this.pipePath = getPlatformPipePath(options?.pipeName);
    this.onDialogueReady = options?.onDialogueReady;
    this.onError = options?.onError;

    this.debounce = new MonotonicSlidingWindowDebounce({
      stabilityThresholdMs: options?.stabilityThresholdMs ?? 180,
      maxHoldTimeMs: options?.maxHoldTimeMs ?? 2500,
      onEmit: (frame) => {
        if (this.onDialogueReady) {
          this.onDialogueReady(frame);
        }
      },
    });
  }

  /**
   * Starts listening for hook DLL connections on the platform IPC pipe.
   */
  public async start(): Promise<string> {
    if (this.isListening) {
      return this.pipePath;
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.handleConnection(socket);
      });

      this.server.on("error", (err) => {
        if (this.onError) {
          this.onError(err);
        }
        reject(err);
      });

      this.server.listen(this.pipePath, () => {
        this.isListening = true;
        resolve(this.pipePath);
      });
    });
  }

  /**
   * Stops the pipe server and closes active connections.
   */
  public async stop(): Promise<void> {
    if (!this.server || !this.isListening) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.debounce.flush();
      this.debounce.reset();

      this.server!.close((err) => {
        this.isListening = false;
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public getPipePath(): string {
    return this.pipePath;
  }

  public getDebounceEngine(): MonotonicSlidingWindowDebounce {
    return this.debounce;
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = "";

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");

      // Frame delimiter: newline or null byte
      let delimiterIndex: number;
      while ((delimiterIndex = this.findDelimiter(buffer)) >= 0) {
        const rawMessage = buffer.slice(0, delimiterIndex).trim();
        buffer = buffer.slice(delimiterIndex + 1);

        if (rawMessage) {
          this.processRawMessage(rawMessage);
        }
      }
    });

    socket.on("error", (err) => {
      if (this.onError) {
        this.onError(err);
      }
    });
  }

  private findDelimiter(buf: string): number {
    const nlIdx = buf.indexOf("\n");
    const nullIdx = buf.indexOf("\0");
    if (nlIdx >= 0 && nullIdx >= 0) return Math.min(nlIdx, nullIdx);
    if (nlIdx >= 0) return nlIdx;
    return nullIdx;
  }

  private processRawMessage(raw: string): void {
    try {
      // JSON-encoded TextFrame
      const parsed = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        const rawText = typeof parsed.rawText === "string" ? parsed.rawText : typeof parsed.text === "string" ? parsed.text : "";
        if (rawText) {
          this.debounce.pushFrame({
            rawText,
            speakerName: typeof parsed.speakerName === "string" ? parsed.speakerName : typeof parsed.speaker === "string" ? parsed.speaker : undefined,
            engineType: this.normalizeEngineType(parsed.engineType),
            processId: typeof parsed.processId === "number" ? parsed.processId : 0,
            timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
          });
        }
      }
    } catch {
      // Plain text fallback (direct string sent over pipe)
      this.debounce.pushFrame({
        rawText: raw,
        engineType: "unknown",
      });
    }
  }

  private normalizeEngineType(raw: unknown): VNEngineType {
    if (typeof raw === "string") {
      const lower = raw.toLowerCase();
      if (lower.includes("renpy")) return "renpy";
      if (lower.includes("unity") || lower.includes("tmp")) return "unity_tmp";
      if (lower.includes("kiri") || lower.includes("kag") || lower.includes("tvp")) return "kirikiri";
      if (lower.includes("gdi")) return "gdi";
    }
    return "unknown";
  }
}
