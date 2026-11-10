/**
 * Visual Novel Memory Hook & Streaming Types
 *
 * Grounded in Section 4 of SuperK Next-Gen Architectural Blueprint:
 * - 4.1 Game Process Engine Hooking (Ren'Py, Unity TextMeshPro, Kirikiri, GDI)
 * - 4.2 Monotonic Sliding Window Debounce for Typewriter Effects
 * - 4.3 Protobuf/Structured IPC Streaming
 *
 * pstack principles:
 * - principle-model-the-domain: Typed TextFrame, Game Engine identifiers, and Debounce state.
 * - principle-laziness-protocol: Clean stream decoupling with zero OCR compute overhead.
 */

export type VNEngineType = "renpy" | "unity_tmp" | "kirikiri" | "gdi" | "unknown";

export interface TextFrame {
  /** Timestamp in milliseconds when frame was captured */
  timestamp: number;
  /** Extracted speaker or character name (if available) */
  speakerName?: string;
  /** Raw dialogue string in game memory (UTF-8) */
  rawText: string;
  /** Game engine type identified by the hook */
  engineType: VNEngineType;
  /** Operating system process ID of the game */
  processId: number;
}

export type DebounceState = "IDLE" | "ACCUMULATING" | "EMITTED";

export interface DebounceOptions {
  /**
   * Minimum duration (in ms) string length must remain stable before emitting translation.
   * Blueprint Section 4.2 recommends 180ms.
   */
  stabilityThresholdMs?: number;
  /** Maximum duration (in ms) to hold accumulation before forcing an emit. Default: 2500ms */
  maxHoldTimeMs?: number;
  /** Optional callback fired when a stable completed dialogue sentence is emitted */
  onEmit?: (frame: TextFrame) => void;
}
