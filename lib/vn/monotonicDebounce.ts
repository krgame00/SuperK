/**
 * Visual Novel Monotonic Sliding Window Debounce Engine
 *
 * Implements Section 4.2 of the SuperK Next-Gen Architectural Blueprint:
 * - Solves Typewriter Effect & 60Hz Re-render Duplication in Visual Novel game hooks.
 * - Monotonic Sliding Window State Machine:
 *     IDLE -> (New text) -> ACCUMULATING -> (Timer >= 180ms stable) -> EMIT_TRANSLATION
 * - Speaker name extraction and duplicate elimination.
 *
 * Grounded in pstack principles:
 * - principle-model-the-domain: Explicit MonotonicWindow buffer and DebounceState transitions.
 * - principle-fix-root-causes: Prevents 60Hz redundant LLM API calls on progressive typewriter frames.
 * - principle-laziness-protocol: Timer-driven event emission without continuous polling.
 */

import { type DebounceOptions, type DebounceState, type TextFrame, type VNEngineType } from "./types";

const SPEAKER_PATTERNS = [
  /^[【「\[]([^】」\]]+)[】」\]]\s*([\s\S]+)$/,
  /^([A-Za-z0-9_\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF]{1,20})\s*[:：]\s*([\s\S]+)$/,
];

/**
 * Extracts speaker name and cleaned dialogue text if formatted with common VN dialogue markers.
 */
export function extractSpeakerAndDialogue(rawText: string): {
  speakerName?: string;
  dialogue: string;
} {
  const trimmed = rawText.trim();
  for (const pattern of SPEAKER_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      return {
        speakerName: match[1].trim(),
        dialogue: match[2].trim(),
      };
    }
  }
  return {
    dialogue: trimmed,
  };
}

export class MonotonicSlidingWindowDebounce {
  private readonly stabilityThresholdMs: number;
  private readonly maxHoldTimeMs: number;
  private readonly onEmit?: (frame: TextFrame) => void;

  private state: DebounceState = "IDLE";
  private currentRawText = "";
  private currentSpeakerName?: string;
  private currentEngineType: VNEngineType = "unknown";
  private currentProcessId = 0;

  private lastFrameTimestamp = 0;
  private accumulationStartTime = 0;
  private stabilityTimer: NodeJS.Timeout | null = null;
  private maxHoldTimer: NodeJS.Timeout | null = null;
  private lastEmittedText = "";

  constructor(options?: DebounceOptions) {
    this.stabilityThresholdMs = options?.stabilityThresholdMs ?? 180;
    this.maxHoldTimeMs = options?.maxHoldTimeMs ?? 2500;
    this.onEmit = options?.onEmit;
  }

  /**
   * Pushes a new raw text frame intercepted from game memory.
   * Returns emitted TextFrame immediately if a completed sentence was ready, or null if accumulating.
   */
  public pushFrame(frame: {
    rawText: string;
    speakerName?: string;
    engineType?: VNEngineType;
    processId?: number;
    timestamp?: number;
  }): TextFrame | null {
    const rawText = frame.rawText.trim();
    if (!rawText) return null;

    const now = frame.timestamp ?? Date.now();
    const engineType = frame.engineType ?? "unknown";
    const processId = frame.processId ?? 0;

    const extracted = extractSpeakerAndDialogue(rawText);
    const dialogue = extracted.dialogue;
    const speakerName = frame.speakerName ?? extracted.speakerName;

    // 1. Exact frame re-render deduplication (60Hz engine duplicate)
    if (this.state === "EMITTED" && dialogue === this.lastEmittedText) {
      return null;
    }

    if (this.state === "ACCUMULATING" && dialogue === this.currentRawText) {
      // Game sent another frame with identical content during typewriter typing
      return null;
    }

    // 2. Check if incoming frame is a progressive typewriter expansion of the current buffer
    const isProgressiveExtension =
      this.state === "ACCUMULATING" &&
      dialogue.startsWith(this.currentRawText) &&
      dialogue.length > this.currentRawText.length;

    let emittedFrame: TextFrame | null = null;

    if (isProgressiveExtension) {
      // Monotonic expansion: string is still typing out
      this.currentRawText = dialogue;
      if (speakerName) {
        this.currentSpeakerName = speakerName;
      }
      if (engineType !== "unknown") {
        this.currentEngineType = engineType;
      }
      if (processId > 0) {
        this.currentProcessId = processId;
      }
      this.lastFrameTimestamp = now;
      this.restartStabilityTimer();
    } else {
      // 3. Dialogue branch: text shrank or changed to a completely new sentence
      if (this.state === "ACCUMULATING") {
        // Flush previous accumulating text if not yet emitted
        emittedFrame = this.flush();
      }

      // Start new accumulation cycle
      this.state = "ACCUMULATING";
      this.currentRawText = dialogue;
      this.currentSpeakerName = speakerName;
      this.currentEngineType = engineType;
      this.currentProcessId = processId;
      this.lastFrameTimestamp = now;
      this.accumulationStartTime = now;

      this.startTimers();
    }

    return emittedFrame;
  }

  /**
   * Manually flushes and emits the current dialogue buffer.
   */
  public flush(): TextFrame | null {
    this.clearTimers();

    if (!this.currentRawText || this.currentRawText === this.lastEmittedText) {
      this.state = "IDLE";
      return null;
    }

    const frame: TextFrame = {
      timestamp: Date.now(),
      speakerName: this.currentSpeakerName,
      rawText: this.currentRawText,
      engineType: this.currentEngineType,
      processId: this.currentProcessId,
    };

    this.lastEmittedText = this.currentRawText;
    this.state = "EMITTED";

    if (this.onEmit) {
      this.onEmit(frame);
    }

    return frame;
  }

  /**
   * Resets the debounce buffer without emitting.
   */
  public reset(): void {
    this.clearTimers();
    this.state = "IDLE";
    this.currentRawText = "";
    this.currentSpeakerName = undefined;
    this.lastEmittedText = "";
  }

  public getState(): DebounceState {
    return this.state;
  }

  public getCurrentBuffer(): string {
    return this.currentRawText;
  }

  private startTimers(): void {
    this.clearTimers();

    this.stabilityTimer = setTimeout(() => {
      this.handleStabilityTimeout();
    }, this.stabilityThresholdMs);

    this.maxHoldTimer = setTimeout(() => {
      this.handleMaxHoldTimeout();
    }, this.maxHoldTimeMs);
  }

  private restartStabilityTimer(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
    }
    this.stabilityTimer = setTimeout(() => {
      this.handleStabilityTimeout();
    }, this.stabilityThresholdMs);
  }

  private handleStabilityTimeout(): void {
    this.flush();
  }

  private handleMaxHoldTimeout(): void {
    if (this.state === "ACCUMULATING") {
      this.flush();
    }
  }

  private clearTimers(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = null;
    }
    if (this.maxHoldTimer) {
      clearTimeout(this.maxHoldTimer);
      this.maxHoldTimer = null;
    }
  }
}
