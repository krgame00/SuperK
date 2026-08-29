import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  WorkspaceExportButtons,
  type WorkspaceExportButtonsProps,
} from "@/components/workspace/WorkspaceExportButtons";

describe("WorkspaceExportButtons", () => {
  it("renders all 5 export buttons with accessible names", () => {
    render(<WorkspaceExportButtons onExport={vi.fn()} />);

    expect(screen.getByRole("button", { name: "ดาวน์โหลดรูปหน้านี้" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด Strip" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด ZIP" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด CBZ" })).toBeInTheDocument();
  });

  it("calls onExport with correct kind on button click", () => {
    const onExport = vi.fn();
    render(<WorkspaceExportButtons onExport={onExport} />);

    fireEvent.click(screen.getByRole("button", { name: "ดาวน์โหลดรูปหน้านี้" }));
    expect(onExport).toHaveBeenCalledWith("image");

    fireEvent.click(screen.getByRole("button", { name: "ดาวน์โหลด PDF" }));
    expect(onExport).toHaveBeenCalledWith("pdf");

    fireEvent.click(screen.getByRole("button", { name: "ดาวน์โหลด Strip" }));
    expect(onExport).toHaveBeenCalledWith("strip");

    fireEvent.click(screen.getByRole("button", { name: "ดาวน์โหลด ZIP" }));
    expect(onExport).toHaveBeenCalledWith("zip");

    fireEvent.click(screen.getByRole("button", { name: "ดาวน์โหลด CBZ" }));
    expect(onExport).toHaveBeenCalledWith("cbz");
  });

  it("disables all buttons when disabled is true", () => {
    render(<WorkspaceExportButtons disabled onExport={vi.fn()} />);

    expect(screen.getByRole("button", { name: "ดาวน์โหลดรูปหน้านี้" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด Strip" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด ZIP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด CBZ" })).toBeDisabled();
  });

  it("disables specific kinds according to disabledKinds prop", () => {
    render(
      <WorkspaceExportButtons
        disabledKinds={{ image: true, zip: true }}
        onExport={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "ดาวน์โหลดรูปหน้านี้" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด PDF" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด Strip" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด ZIP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "ดาวน์โหลด CBZ" })).toBeEnabled();
  });
});
