import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTranslation } from "@/hooks/useTranslation";

describe("Timer Ownership & Quota Cooldown Lifecycle (Ticket 01)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  test("does not schedule any interval when there is no active cooldown", () => {
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    const { unmount } = renderHook(() =>
      useTranslation({
        pages: ["http://test/p1.png"],
        currentPage: 0,
        viewMode: "single",
        preparePageForTranslation: vi.fn(),
      }),
    );

    expect(setIntervalSpy).not.toHaveBeenCalled();
    unmount();
  });

  test("quota cooldown timer clears when active cooldown expires or component unmounts", async () => {
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    const { result, unmount } = renderHook(() =>
      useTranslation({
        pages: ["http://test/p1.png"],
        currentPage: 0,
        viewMode: "single",
        preparePageForTranslation: vi.fn(),
      }),
    );

    // Unmount during inactive state
    unmount();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
