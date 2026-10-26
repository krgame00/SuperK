import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SystemLogsModal } from "@/components/workspace/SystemLogsModal";
import type { LogEntry } from "@/lib/logger/types";

describe("SystemLogsModal", () => {
  const mockLogs: LogEntry[] = [
    {
      id: "1",
      timestamp: 1600000000000,
      isoTime: "2026-10-18T10:00:00.000Z",
      level: "error",
      category: "translate",
      message: "Gemini quota exceeded",
      details: { status: 429 },
      source: "client",
    },
    {
      id: "2",
      timestamp: 1600000001000,
      isoTime: "2026-10-18T10:00:01.000Z",
      level: "warn",
      category: "network",
      message: "Slow network roundtrip",
      source: "server",
    },
    {
      id: "3",
      timestamp: 1600000002000,
      isoTime: "2026-10-18T10:00:02.000Z",
      level: "info",
      category: "system",
      message: "System ready",
      source: "client",
    },
  ];

  it("does not render when isOpen is false", () => {
    const { container } = render(
      <SystemLogsModal isOpen={false} onClose={vi.fn()} initialLogs={mockLogs} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders log entries and counts when isOpen is true", () => {
    render(<SystemLogsModal isOpen={true} onClose={vi.fn()} initialLogs={mockLogs} />);

    expect(screen.getByText("บันทึกข้อผิดพลาดและสถานะระบบ (System Logs)")).toBeInTheDocument();
    expect(screen.getByText("Gemini quota exceeded")).toBeInTheDocument();
    expect(screen.getByText("Slow network roundtrip")).toBeInTheDocument();
    expect(screen.getByText("System ready")).toBeInTheDocument();
  });

  it("filters by level when clicking level pills", async () => {
    render(<SystemLogsModal isOpen={true} onClose={vi.fn()} initialLogs={mockLogs} />);

    // Click "Error" filter button
    const errorBtn = screen.getByRole("button", { name: /error/i });
    fireEvent.click(errorBtn);

    expect(screen.getByText("Gemini quota exceeded")).toBeInTheDocument();
    expect(screen.queryByText("Slow network roundtrip")).not.toBeInTheDocument();
    expect(screen.queryByText("System ready")).not.toBeInTheDocument();
  });

  it("filters by search term", () => {
    render(<SystemLogsModal isOpen={true} onClose={vi.fn()} initialLogs={mockLogs} />);

    const searchInput = screen.getByPlaceholderText(/ค้นหาข้อความ/i);
    fireEvent.change(searchInput, { target: { value: "quota" } });

    expect(screen.getByText("Gemini quota exceeded")).toBeInTheDocument();
    expect(screen.queryByText("Slow network roundtrip")).not.toBeInTheDocument();
  });

  it("invokes onClose when clicking close button or pressing Escape", () => {
    const onClose = vi.fn();
    render(<SystemLogsModal isOpen={true} onClose={onClose} initialLogs={mockLogs} />);

    const closeBtn = screen.getByRole("button", { name: "ปิดหน้าต่าง" });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
