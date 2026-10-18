"use client";

import { useCallback, type SetStateAction } from "react";
import type { TranslatedBubble } from "@/lib/translationOverlay";
import type { WorkspaceExportPage } from "@/hooks/useExportOrchestrator";
import type { PageCleaningResult } from "@/hooks/useCleaning";
import type { WorkspaceLayer } from "@/components/cleaning/CleaningToolbar";
import type { ReplaceOptions } from "@/components/editing/FindReplaceDialog";
import type { GlossaryEntry } from "@/lib/translation/glossary";

export interface UseWorkspaceTextActionsOptions {
  pages: WorkspaceExportPage[];
  currentPage: number;
  activeBubbles: TranslatedBubble[];
  bubbleCacheRef: { current: Map<string, TranslatedBubble[]> };
  translatedImages?: Map<string, string>;
  translationCacheRevision: number;
  setWorkspaceLayer: (value: SetStateAction<WorkspaceLayer>) => void;
  glossary: GlossaryEntry[];
  setGlossary: (items: GlossaryEntry[]) => void;
  cleaningResultsByPage: Map<string, PageCleaningResult>;
  replaceBubbleText: (options: {
    pageUrls: string[];
    backgroundUrls: Record<string, string>;
    transform: (b: TranslatedBubble) => boolean;
  }) => number;
}

export function useWorkspaceTextActions({
  pages,
  currentPage,
  activeBubbles,
  bubbleCacheRef,
  translatedImages,
  translationCacheRevision,
  setWorkspaceLayer,
  glossary,
  setGlossary,
  cleaningResultsByPage,
  replaceBubbleText,
}: UseWorkspaceTextActionsOptions) {
  const currentPageUrl = pages[currentPage]?.url;
  const translatedImagesMap = translatedImages ?? new Map<string, string>();
  const hasPageBubbles = Boolean(
    currentPageUrl &&
      ((activeBubbles.length > 0 && activeBubbles.some((b) => !b.deleted)) ||
        (bubbleCacheRef.current.get(currentPageUrl)?.some((b) => !b.deleted) ?? false)),
  );
  const hasRenderedTranslation = Boolean(
    currentPageUrl && (translatedImagesMap?.has(currentPageUrl) ?? false),
  );
  const hasCurrentTranslation = Boolean(
    currentPageUrl &&
      translationCacheRevision >= 0 &&
      (hasPageBubbles || hasRenderedTranslation),
  );

  const toggleOriginalTranslated = useCallback(() => {
    setWorkspaceLayer((currentLayer) =>
      currentLayer === "original" && hasCurrentTranslation
        ? "translated"
        : "original",
    );
  }, [hasCurrentTranslation, setWorkspaceLayer]);

  const handleAutoExtractGlossary = useCallback(async () => {
    const { extractGlossaryCandidatesFromBubbles } = await import("@/lib/translation/glossary");
    const allBubbles: TranslatedBubble[] = [];
    for (const p of pages) {
      const list = bubbleCacheRef.current.get(p.url);
      if (list && list.length > 0) allBubbles.push(...list);
    }
    const candidates = extractGlossaryCandidatesFromBubbles(allBubbles, glossary);
    const toast = (await import("react-hot-toast")).default;
    if (candidates.length === 0) {
      toast("ไม่พบชื่อเฉพาะหรือคำศัพท์ซ้ำใหม่ๆ จากหน้าที่แปลแล้ว", { icon: "ℹ️" });
      return;
    }
    setGlossary([...glossary, ...candidates]);
    toast.success(`✨ เพิ่มคำศัพท์/ชื่อเฉพาะใหม่ ${candidates.length} คำเข้า Glossary แล้ว!`);
  }, [pages, bubbleCacheRef, glossary, setGlossary]);

  const handleFindReplace = useCallback(
    ({ find, replace, scope, caseSensitive }: ReplaceOptions) => {
      if (!find) return;

      // Compare the replaced output instead of regex.test() - /g regexes are
      // stateful under .test(), which silently skips matches on later bubbles.
      const regex = new RegExp(
        find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        caseSensitive ? "g" : "gi",
      );
      let count = 0;
      const transform = (b: TranslatedBubble): boolean => {
        const text =
          typeof b.t === "string"
            ? b.t
            : typeof b.translated === "string"
              ? b.translated
              : "";
        if (!text) return false;
        // Function replacer: treat `replace` literally - "$&"/"$1" typed by
        // the user must not be interpreted as replacement metacharacters.
        const newText = text.replace(regex, () => replace);
        if (newText === text) return false;
        b.t = newText;
        if (typeof b.translated === "string") b.translated = newText;
        count++;
        return true;
      };

      if (scope === "this-page") {
        const currentUrl = pages[currentPage]?.url;
        if (currentUrl) {
          count = replaceBubbleText({
            pageUrls: [currentUrl],
            backgroundUrls: {
              [currentUrl]:
                cleaningResultsByPage.get(currentUrl)?.cleanUrl ?? currentUrl,
            },
            transform,
          });
        }
      } else {
        const pageUrls = [...bubbleCacheRef.current.keys()];
        count = replaceBubbleText({
          pageUrls,
          backgroundUrls: Object.fromEntries(
            pageUrls.map((url) => [
              url,
              cleaningResultsByPage.get(url)?.cleanUrl ?? url,
            ]),
          ),
          transform,
        });
      }

      import("react-hot-toast").then((m) => {
        if (count > 0) {
          m.default(`🔄 แทนที่ข้อความสำเร็จ ${count} จุด`, { duration: 2000 });
        } else {
          m.default("ไม่พบข้อความที่ตรงกับคำค้นหา", { duration: 2000 });
        }
      });
    },
    [pages, currentPage, bubbleCacheRef, cleaningResultsByPage, replaceBubbleText],
  );

  return {
    currentPageUrl,
    translatedImagesMap,
    hasPageBubbles,
    hasRenderedTranslation,
    hasCurrentTranslation,
    toggleOriginalTranslated,
    handleAutoExtractGlossary,
    handleFindReplace,
  };
}
