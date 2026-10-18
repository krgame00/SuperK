"use client";

import { Toaster } from "react-hot-toast";
import { WorkspaceHeaderHost } from "@/components/workspace/WorkspaceHeaderHost";
import { WorkspaceCanvasHost } from "@/components/workspace/WorkspaceCanvasHost";
import { WorkspaceBottomStripHost } from "@/components/workspace/WorkspaceBottomStripHost";
import { WorkspaceModalsHost } from "@/components/workspace/WorkspaceModalsHost";
import { useWorkspaceController } from "@/hooks/useWorkspaceController";

export default function WorkspacePage() {
  const {
    headerProps,
    canvasProps,
    bottomStripProps,
    modalsProps,
    rootProps,
    translateAllProgress,
    isFocusMode,
  } = useWorkspaceController();

  return (
    <div
      className="min-h-screen bg-background text-foreground flex flex-col font-sans"
      onDragOver={rootProps.onDragOver}
      onDragLeave={rootProps.onDragLeave}
      onDrop={rootProps.onDrop}
    >
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "var(--surface)",
            color: "var(--foreground)",
            border: "1px solid var(--surface-hover)",
          },
        }}
      />

      {/* Batch Progress Bar - Full Width */}
      {translateAllProgress && (
        <div
          className={`fixed left-0 right-0 z-50 transition-all duration-200 ${
            isFocusMode ? "top-0" : "top-14"
          }`}
        >
          <div className="h-1 bg-surface/60 backdrop-blur-xs w-full">
            <div
              className="h-full bg-primary shadow-[0_0_8px_rgba(var(--primary-rgb),0.7)] transition-all duration-500 ease-out"
              style={{
                width: `${(translateAllProgress.current / translateAllProgress.total) * 100}%`,
              }}
            />
          </div>
        </div>
      )}

      {/* Header Panel */}
      <WorkspaceHeaderHost {...headerProps} />

      {/* Main Workspace */}
      <WorkspaceCanvasHost {...canvasProps} />

      {/* Bottom Thumbnail Strip & Remnant Review */}
      <WorkspaceBottomStripHost {...bottomStripProps} />

      {/* Modals & Dialogs */}
      <WorkspaceModalsHost {...modalsProps} />
    </div>
  );
}
