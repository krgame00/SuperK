"use client";

import { useState, useEffect, useCallback } from "react";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { PageCleaningResult, PageRemnantTextEvidence } from "@/hooks/useCleaning";
import type { WorkspaceTextStyle } from "@/components/workspace/SettingsModal";
import type { GlossaryEntry } from "@/lib/translation/glossary";
import { fetchExtensionPairingToken } from "@/hooks/useWorkspaceDocumentManager";
import {
  getPageOutputBlockers,
  type PageReviewInfo,
} from "@/lib/export/reviewGate";
import type { PageTargetIdentity } from "@/lib/translation/pageEligibility";
import {
  backgroundEligibilityState,
  type BackgroundInspectionResult,
} from "@/lib/cleaning/backgroundRemnantInspection";

export interface UseExtensionWorkspaceBridgeOptions {
  pages: WorkspaceExportPage[];
  currentPage: number;
  userApiKey: string;
  modelPreference: string;
  allowPreviewModels: boolean;
  glossary: GlossaryEntry[];
  textStyle: WorkspaceTextStyle;
  targetLang: string;
  sourceLang: string;
  bubbleCacheRef: { current: Map<string, TranslatedBubble[]> };
  pageTargetCacheRef: { current: { get: (key: string) => PageTargetIdentity | string | undefined } };
  getCurrentRemnantReview?: (
    pageUrl: string,
    expectedEvidence?: PageRemnantTextEvidence,
  ) => { inspection?: BackgroundInspectionResult } | undefined;
  getExpectedRemnantEvidence: (pageUrl: string) => PageRemnantTextEvidence | undefined;
  getPageSourceRevision?: (pageUrl: string) => string | undefined;
  cleaningResultsByPage: Map<string, PageCleaningResult>;
  translatedImages?: Map<string, string>;
  exportInputSignature: (pageUrl: string) => string;
  collectExportReviewPages: (
    pages: WorkspaceExportPage[],
    indices: number[],
  ) => PageReviewInfo[];
}

export function useExtensionWorkspaceBridge({
  pages,
  currentPage,
  userApiKey,
  modelPreference,
  allowPreviewModels,
  glossary,
  textStyle,
  targetLang,
  sourceLang,
  bubbleCacheRef,
  pageTargetCacheRef,
  getCurrentRemnantReview,
  getExpectedRemnantEvidence,
  getPageSourceRevision,
  cleaningResultsByPage,
  translatedImages,
  exportInputSignature,
  collectExportReviewPages,
}: UseExtensionWorkspaceBridgeOptions) {
  const [pairingToken, setPairingToken] = useState<string>("");
  const [isPublishingBack, setIsPublishingBack] = useState(false);

  useEffect(() => {
    fetch("/api/extension/pair")
      .then((res) => res.json())
      .then((data) => {
        if (data.pairingToken) setPairingToken(data.pairingToken);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!pairingToken) return;
    const controller = new AbortController();
    void fetch("/api/extension/settings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pairingToken}`,
      },
      body: JSON.stringify({
        geminiApiKey: userApiKey,
        modelPreference,
        allowPreviewModels,
        glossary,
        textStyle,
        targetLang,
        sourceLang,
      }),
      signal: controller.signal,
    }).catch(() => undefined);
    return () => controller.abort();
  }, [
    pairingToken,
    userApiKey,
    modelPreference,
    allowPreviewModels,
    glossary,
    textStyle,
    targetLang,
    sourceLang,
  ]);

  const handlePublishBackToReadingView = useCallback(async () => {
    const page = pages[currentPage];
    if (!page || !page.originUrl) return;

    // Publication shares the export eligibility boundary: deterministic script
    // failures, unresolved review evidence, unconfirmed targets and unresolved
    // background-remnant findings block publish-back; generated-text approval
    // cannot clear them. Recomputed from raw text at each attempt.
    const publicationBubbles = JSON.parse(
      JSON.stringify(bubbleCacheRef.current.get(page.url) ?? []),
    ) as TranslatedBubble[];
    const publicationTarget = pageTargetCacheRef.current.get(page.url);
    const publicationBackground = getCurrentRemnantReview?.(
      page.url,
      getExpectedRemnantEvidence(page.url),
    )?.inspection;
    const publicationSource = getPageSourceRevision?.(page.url);
    const blockers = getPageOutputBlockers(
      publicationBubbles,
      publicationTarget,
      publicationBackground,
      publicationSource,
    );
    if (
      blockers.targetUnconfirmed ||
      blockers.scriptIssueCount > 0 ||
      blockers.unverifiedReviewCount > 0 ||
      blockers.backgroundBlocked
    ) {
      const details = [
        blockers.targetUnconfirmed ? "ยังไม่ยืนยันภาษาของหน้า" : null,
        blockers.scriptIssueCount > 0
          ? `ตัวอักษรภาษาอื่นปน ${blockers.scriptIssueCount} จุด`
          : null,
        blockers.unverifiedReviewCount > 0
          ? `ยังไม่ได้ตรวจกับต้นฉบับ ${blockers.unverifiedReviewCount} จุด`
          : null,
        blockers.backgroundBlocked ? "พบร่องรอยต้องตรวจในภาพพื้นหลัง" : null,
      ]
        .filter(Boolean)
        .join(", ");
      (await import("react-hot-toast")).default(
        `❌ ยังส่งกลับหน้าอ่านไม่ได้: ${details} — เปิด เครื่องมือ > ตรวจคำแปลทั้งเล่ม เพื่อตรวจและยืนยันก่อน`,
        { duration: 6000 },
      );
      return;
    }

    const publicationSignature = exportInputSignature(page.url);
    setIsPublishingBack(true);
    try {
      let cleanUrl =
        cleaningResultsByPage.get(page.url)?.cleanUrl ||
        translatedImages?.get(page.url);
      if (cleanUrl && cleanUrl.startsWith("blob:")) {
        try {
          const blobRes = await fetch(cleanUrl);
          const blob = await blobRes.blob();
          cleanUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        } catch (blobErr) {
          console.warn(
            "Failed to convert blob cleanUrl to base64 data URL for publish-back:",
            blobErr,
          );
        }
      }
      const pairingToken = await fetchExtensionPairingToken();
      if (
        publicationSignature !== exportInputSignature(page.url) ||
        collectExportReviewPages([{ ...page, exportSource: "translated" }], [0])
          .length > 0
      ) {
        throw new Error("หลักฐานเปลี่ยนระหว่างส่งกลับ กรุณาตรวจหน้าอีกครั้ง");
      }
      const res = await fetch("/api/extension/publish-back", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(pairingToken ? { Authorization: `Bearer ${pairingToken}` } : {}),
        },
        body: JSON.stringify({
          pageUrl: page.readerImageUrl || page.url,
          originUrl: page.originUrl,
          bubbles: publicationBubbles,
          targetIdentity: publicationTarget,
          sourceRevision: publicationSource,
          backgroundEvidence: publicationBackground,
          backgroundState: publicationBackground
            ? backgroundEligibilityState(publicationBackground)
            : undefined,
          backgroundRevision: publicationBackground?.revisionKey,
          textStyle,
          cleanUrl,
        }),
      });

      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}`);
      }

      const toast = (await import("react-hot-toast")).default;
      toast.success("🚀 ส่งคำแปลที่ปรับแต่งกลับไปยังหน้าอ่านแล้ว!");
    } catch (err) {
      console.error("Failed to publish back to reading view:", err);
      const toast = (await import("react-hot-toast")).default;
      toast.error("ส่งกลับหน้าอ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setIsPublishingBack(false);
    }
  }, [
    pages,
    currentPage,
    bubbleCacheRef,
    pageTargetCacheRef,
    getCurrentRemnantReview,
    getExpectedRemnantEvidence,
    getPageSourceRevision,
    exportInputSignature,
    cleaningResultsByPage,
    translatedImages,
    collectExportReviewPages,
    textStyle,
  ]);

  return {
    pairingToken,
    isPublishingBack,
    handlePublishBackToReadingView,
  };
}
