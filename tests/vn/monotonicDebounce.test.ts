import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractSpeakerAndDialogue,
  MonotonicSlidingWindowDebounce,
} from "@/lib/vn/monotonicDebounce";
import { type TextFrame } from "@/lib/vn/types";

describe("Visual Novel Monotonic Sliding Window Debounce (Blueprint Module 4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("extractSpeakerAndDialogue", () => {
    it("extracts Japanese-style bracketed speaker 【名前】", () => {
      const res = extractSpeakerAndDialogue("【桜】おはようございます！");
      expect(res.speakerName).toBe("桜");
      expect(res.dialogue).toBe("おはようございます！");
    });

    it("extracts Western-style bracketed speaker [Sakura]", () => {
      const res = extractSpeakerAndDialogue("[Sakura] Good morning!");
      expect(res.speakerName).toBe("Sakura");
      expect(res.dialogue).toBe("Good morning!");
    });

    it("extracts colon-separated speaker name", () => {
      const res = extractSpeakerAndDialogue("Heroine: Let's go to the beach.");
      expect(res.speakerName).toBe("Heroine");
      expect(res.dialogue).toBe("Let's go to the beach.");
    });

    it("handles plain dialogue without speaker", () => {
      const res = extractSpeakerAndDialogue("どこかへ行こうか。");
      expect(res.speakerName).toBeUndefined();
      expect(res.dialogue).toBe("どこかへ行こうか。");
    });
  });

  describe("MonotonicSlidingWindowDebounce typewriter accumulation", () => {
    it("accumulates progressive typewriter frames and emits only after 180ms stability", () => {
      const emitted: TextFrame[] = [];
      const debounce = new MonotonicSlidingWindowDebounce({
        stabilityThresholdMs: 180,
        onEmit: (frame) => emitted.push(frame),
      });

      // Typewriter frames at 50ms intervals
      debounce.pushFrame({ rawText: "ส" });
      vi.advanceTimersByTime(50);
      expect(emitted).toHaveLength(0);

      debounce.pushFrame({ rawText: "สวั" });
      vi.advanceTimersByTime(50);
      expect(emitted).toHaveLength(0);

      debounce.pushFrame({ rawText: "สวัส" });
      vi.advanceTimersByTime(50);
      expect(emitted).toHaveLength(0);

      debounce.pushFrame({ rawText: "สวัสดี" });
      vi.advanceTimersByTime(50);
      expect(emitted).toHaveLength(0); // Only 50ms passed since last growth

      // Wait 130ms (total 180ms since last growth)
      vi.advanceTimersByTime(130);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].rawText).toBe("สวัสดี");
      expect(debounce.getState()).toBe("EMITTED");
    });

    it("filters exact frame re-render duplicates from 60Hz game engines", () => {
      const emitted: TextFrame[] = [];
      const debounce = new MonotonicSlidingWindowDebounce({
        stabilityThresholdMs: 180,
        onEmit: (frame) => emitted.push(frame),
      });

      debounce.pushFrame({ rawText: "สวัสดี" });
      // Duplicate 60Hz frame sent at 16ms
      vi.advanceTimersByTime(16);
      debounce.pushFrame({ rawText: "สวัสดี" });
      // Duplicate 60Hz frame sent at 32ms
      vi.advanceTimersByTime(16);
      debounce.pushFrame({ rawText: "สวัสดี" });

      // After 180ms from initial frame
      vi.advanceTimersByTime(180);

      expect(emitted).toHaveLength(1);
      expect(emitted[0].rawText).toBe("สวัสดี");

      // Repeated frames after emission are also ignored
      debounce.pushFrame({ rawText: "สวัสดี" });
      expect(emitted).toHaveLength(1);
    });

    it("flushes previous sentence immediately when new sentence arrives before timeout", () => {
      const emitted: TextFrame[] = [];
      const debounce = new MonotonicSlidingWindowDebounce({
        stabilityThresholdMs: 180,
        onEmit: (frame) => emitted.push(frame),
      });

      debounce.pushFrame({ rawText: "ประโยคแรกที่ยังพิมพ์ไม่เสร็จ..." });
      vi.advanceTimersByTime(80);

      // User skips text or next line arrives immediately
      debounce.pushFrame({ rawText: "ประโยคที่สองมาแทนที่" });

      // First sentence flushed
      expect(emitted).toHaveLength(1);
      expect(emitted[0].rawText).toBe("ประโยคแรกที่ยังพิมพ์ไม่เสร็จ...");

      // Wait 180ms for second sentence
      vi.advanceTimersByTime(180);
      expect(emitted).toHaveLength(2);
      expect(emitted[1].rawText).toBe("ประโยคที่สองมาแทนที่");
    });

    it("respects maxHoldTimeMs to prevent indefinite accumulation on slow typewriters", () => {
      const emitted: TextFrame[] = [];
      const debounce = new MonotonicSlidingWindowDebounce({
        stabilityThresholdMs: 180,
        maxHoldTimeMs: 1000,
        onEmit: (frame) => emitted.push(frame),
      });

      let current = "";
      // Append a character every 100ms (never reaches 180ms stability)
      for (let i = 0; i < 15; i++) {
        current += `char${i}`;
        debounce.pushFrame({ rawText: current });
        vi.advanceTimersByTime(100);
      }

      // Max hold time (1000ms) fired
      expect(emitted.length).toBeGreaterThanOrEqual(1);
    });
  });
});
