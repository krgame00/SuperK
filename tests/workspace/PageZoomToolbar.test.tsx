import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { PageZoomToolbar } from "@/components/workspace/PageZoomToolbar";

describe("PageZoomToolbar", () => {
  const defaultSingleProps = {
    viewLayout: "single" as const,
    scale: 1.0,
    displayPercentage: 100,
    isFit: false,
    scrollZoomMode: "fit-width" as const,
    disabled: false,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onZoomTo: vi.fn(),
    onResetToFit: vi.fn(),
    onToggleScrollZoomMode: vi.fn(),
  };

  test("renders zoom controls in single-page mode", () => {
    render(<PageZoomToolbar {...defaultSingleProps} />);

    expect(screen.getByRole("button", { name: "ซูมออก" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ซูมเข้า" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "พอดีหน้าจอ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ระดับการซูม 100 เปอร์เซ็นต์" })).toBeInTheDocument();
  });

  test("clicking zoom buttons triggers corresponding callbacks", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onResetToFit = vi.fn();

    render(
      <PageZoomToolbar
        {...defaultSingleProps}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onResetToFit={onResetToFit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "ซูมเข้า" }));
    expect(onZoomIn).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "ซูมออก" }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "พอดีหน้าจอ" }));
    expect(onResetToFit).toHaveBeenCalledTimes(1);
  });

  test("opens percentage dropdown menu and selects scale preset", () => {
    const onZoomTo = vi.fn();
    render(<PageZoomToolbar {...defaultSingleProps} onZoomTo={onZoomTo} />);

    const menuTrigger = screen.getByRole("button", { name: "ระดับการซูม 100 เปอร์เซ็นต์" });
    fireEvent.click(menuTrigger);

    // Dropdown should be open
    expect(screen.getByRole("menu")).toBeInTheDocument();
    const preset200 = screen.getByRole("menuitem", { name: "200%" });
    fireEvent.click(preset200);

    expect(onZoomTo).toHaveBeenCalledWith(2.0);
  });

  test("renders continuous-scroll mode controls with Fit Width and Actual Size toggles", () => {
    const onToggleScrollZoomMode = vi.fn();
    render(
      <PageZoomToolbar
        {...defaultSingleProps}
        viewLayout="scroll"
        scrollZoomMode="fit-width"
        onToggleScrollZoomMode={onToggleScrollZoomMode}
      />,
    );

    const fitWidthBtn = screen.getByRole("button", { name: "พอดีความกว้าง" });
    const actualSizeBtn = screen.getByRole("button", { name: "ขนาดจริง (100%)" });

    expect(fitWidthBtn).toBeInTheDocument();
    expect(actualSizeBtn).toBeInTheDocument();

    fireEvent.click(actualSizeBtn);
    expect(onToggleScrollZoomMode).toHaveBeenCalledTimes(1);
  });

  test("disables controls when disabled prop is true", () => {
    render(<PageZoomToolbar {...defaultSingleProps} disabled={true} />);

    expect(screen.getByRole("button", { name: "ซูมออก" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ซูมเข้า" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "พอดีหน้าจอ" })).toBeDisabled();
  });

  test("renders Focus Mode button and triggers onToggleFocusMode callback", () => {
    const onToggleFocusMode = vi.fn();
    const { rerender } = render(
      <PageZoomToolbar
        {...defaultSingleProps}
        isFocusMode={false}
        onToggleFocusMode={onToggleFocusMode}
      />,
    );

    const focusBtn = screen.getByRole("button", { name: "เปิดโหมดโฟกัส (F)" });
    expect(focusBtn).toBeInTheDocument();
    expect(focusBtn).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(focusBtn);
    expect(onToggleFocusMode).toHaveBeenCalledTimes(1);

    // Rerender in active Focus Mode
    rerender(
      <PageZoomToolbar
        {...defaultSingleProps}
        isFocusMode={true}
        onToggleFocusMode={onToggleFocusMode}
      />,
    );

    const exitFocusBtn = screen.getByRole("button", { name: "ออกจากโหมดโฟกัส (Esc หรือ F)" });
    expect(exitFocusBtn).toBeInTheDocument();
    expect(exitFocusBtn).toHaveAttribute("aria-pressed", "true");
  });
});
