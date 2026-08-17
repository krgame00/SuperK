import { useState, useRef, useEffect, useCallback } from "react";
import {
  getTranslationRetryDelay,
  readTranslationResponse,
  TranslationRequestError,
} from "@/lib/translation/requestError";
import { applyTranslationOverlay } from "@/lib/translationOverlay";
import { saveProjectSession, loadProjectSession, clearProjectSession } from "@/lib/projectStore";
import { resolveTranslationOutcome } from "@/lib/translationPipeline";
import { parseLLMJSON } from "@/lib/parseLLMJSON";

export type TranslationWorkflowPhase = "cleaning" | "translating";

export interface BatchPageFailure {
  pageIndex: number;
  pageUrl: string;
  stage: "cleaning" | "translation";
  message: string;
}

export interface PreparedTranslationPage {
  recognitionUrl: string;
  backgroundUrl: string;
}

interface UseTranslationProps {
  currentPage: number;
  pages: string[];
  viewMode: "single" | "scroll";
  preparePageForTranslation: (
    pageUrl: string,
    pageIndex: number,
  ) => Promise<PreparedTranslationPage>;
}

const waitForImageReady = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      image.onload = null;
      image.onerror = null;
      reject(new Error("โหลดรูปภาพไม่สำเร็จ"));
    }, 30_000);

    const cleanup = () => {
      clearTimeout(watchdog);
      image.onload = null;
      image.onerror = null;
    };
    image.onload = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(image);
    };
    image.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("โหลดรูปภาพไม่สำเร็จ"));
    };
    image.src = src;
  });

export function useTranslation({
  currentPage,
  pages,
  viewMode,
  preparePageForTranslation,
}: UseTranslationProps) {
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateAllProgress, setTranslateAllProgress] = useState<{
    current: number;
    total: number;
    status: "cleaning" | "translating" | "waiting" | "cooldown";
    message: string;
    startTime: number;
  } | null>(null);
  const cancelTranslateAllRef = useRef(false);
  const translationOperationLockRef = useRef(false);
  const [batchFailures, setBatchFailures] = useState<BatchPageFailure[]>([]);
  const [workflowPhase, setWorkflowPhase] =
    useState<TranslationWorkflowPhase | null>(null);

  const [targetLang, setTargetLang] = useState("Thai");
  const [sourceLang, setSourceLang] = useState("auto");
  const [modelPreference, setModelPreference] = useState("auto");
  const [textStyle, setTextStyle] = useState({
    fontFamily: "Itim, sans-serif",
    textColor: "#000000",
    textOutline: "#FFFFFF",
    fontSizeMultiplier: 1.0
  });
  const textStyleRef = useRef(textStyle);

  const [nsfwBypassMode, setNsfwBypassMode] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationResult, setTranslationResult] = useState<string | null>(null);
  const [showTranslate, setShowTranslate] = useState(false);
  const [activeBubbles, setActiveBubbles] = useState<any[]>([]);
  const [cacheRevision, setCacheRevision] = useState(0);

  useEffect(() => {
    textStyleRef.current = textStyle;
    activeBubbles.forEach(b => {
      if (typeof b.render === 'function') b.render();
    });
  }, [textStyle, activeBubbles]);
  const [userApiKey, setUserApiKey] = useState("");

  const activePageRef = useRef("");
  useEffect(() => {
    if (pages.length > 0) {
      activePageRef.current = pages[currentPage];
    }
  }, [currentPage, pages]);

  // Load API key from local storage on mount
  useEffect(() => {
    const savedKey = localStorage.getItem("gemini_api_key");
    if (savedKey) setUserApiKey(savedKey);
  }, []);

  // Per-page bubble cache, keyed by image data URL so it survives reordering
  const bubbleCacheRef = useRef<Map<string, any[]>>(new Map());
  // Per-page final translated image dataUrl cache
  const translatedImageCacheRef = useRef<Map<string, string>>(new Map());

  const getManualBubblesForPage = (pageUrl: string): any[] => {
    const cachedBubbles = bubbleCacheRef.current.get(pageUrl);
    if (cachedBubbles) {
      return cachedBubbles.filter((bubble) => bubble.isManual);
    }
    if (activePageRef.current === pageUrl) {
      return activeBubbles.filter((bubble) => bubble.isManual);
    }
    return [];
  };

  // When currentPage changes, restore cached bubbles and re-apply overlay
  useEffect(() => {
    if (pages.length === 0) return;
    const currentKey = pages[currentPage];
    const cached = bubbleCacheRef.current.get(currentKey);
    if (cached && cached.length > 0) {
      setActiveBubbles(cached);
      // Small delay so the DOM (pageContainer + img) is rendered first
      const timer = setTimeout(() => {
        applyTranslationOverlay(
          cached,
          viewMode,
          currentPage,
          setTranslationResult,
          undefined,
          textStyleRef,
        );
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setActiveBubbles([]);
    }
  }, [currentPage, pages, viewMode]);

  // Auto-save session to IndexedDB (debounced)
  useEffect(() => {
    if (pages.length === 0) return;
    const timer = setTimeout(() => {
      saveProjectSession({
        pages: pages.map(p => typeof p === 'string' ? { url: p, name: 'Page' } : p),
        currentPage,
        bubbleCache: bubbleCacheRef.current,
        translatedImageCache: translatedImageCacheRef.current
      });
    }, 1000);
    return () => clearTimeout(timer);
  }, [pages, currentPage, activeBubbles, cacheRevision]);

  // Restore saved session helper
  const restoreSavedSession = async () => {
    const saved = await loadProjectSession();
    if (!saved) return null;
    bubbleCacheRef.current = saved.bubbleCache;
    translatedImageCacheRef.current = saved.translatedImageCache;
    return saved;
  };

  const clearSavedSession = async () => {
    bubbleCacheRef.current.clear();
    translatedImageCacheRef.current.clear();
    await clearProjectSession();
  };

  const translateCrop = async (cropBox: { x: number, y: number, w: number, h: number }, cropBase64: string, fullWidth: number, fullHeight: number) => {
    setIsTranslating(true);
    setTranslationResult("กำลังแปลเฉพาะจุดที่เลือก...");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: cropBase64, mimeType: "image/jpeg", targetLang, sourceLang, modelPreference, apiKey: userApiKey })
      });
      const data = await readTranslationResponse<{ text: string }>(res);
      const parsed = JSON.parse(data.text);
      if (!parsed || !parsed.bubbles || parsed.bubbles.length === 0) {
        setTranslationResult("❌ ไม่พบข้อความในจุดที่เลือก");
        return;
      }

      const newBubbles = parsed.bubbles.map((b: any) => {
        if (!b.box || b.box.length !== 4) return b;
        const cropYminPx = (b.box[0] / 1000) * cropBox.h;
        const cropXminPx = (b.box[1] / 1000) * cropBox.w;
        const cropYmaxPx = (b.box[2] / 1000) * cropBox.h;
        const cropXmaxPx = (b.box[3] / 1000) * cropBox.w;
        return {
          ...b,
          box: [
            ((cropBox.y + cropYminPx) / fullHeight) * 1000,
            ((cropBox.x + cropXminPx) / fullWidth) * 1000,
            ((cropBox.y + cropYmaxPx) / fullHeight) * 1000,
            ((cropBox.x + cropXmaxPx) / fullWidth) * 1000
          ],
          isManual: true
        };
      });

      const updatedBubbles = [...activeBubbles, ...newBubbles];
      bubbleCacheRef.current.set(pages[currentPage], updatedBubbles);

      if (activePageRef.current === pages[currentPage]) {
        setActiveBubbles(updatedBubbles);
        applyTranslationOverlay(updatedBubbles, viewMode, currentPage, setTranslationResult, (dataUrl) => {
          translatedImageCacheRef.current.set(pages[currentPage], dataUrl);
        }, textStyleRef);
        setTranslationResult("✅ แปลเฉพาะจุดสำเร็จ!");
      }

    } catch (error: any) {
      setTranslationResult("❌ Error: " + error.message);
    } finally {
      setIsTranslating(false);
      setTimeout(() => setTranslationResult(null), 4000);
    }
  };

  const renderAndCacheTranslation = useCallback(
    async (
      bubbles: any[],
      backgroundUrl: string,
      pageUrl: string,
      pageIndex: number,
    ): Promise<void> => {
      const offscreenContainer = document.createElement("div");
      offscreenContainer.dataset.translationOffscreen = pageUrl;
      offscreenContainer.style.cssText =
        "position:fixed;left:-100000px;top:0;pointer-events:none;";
      const image = document.createElement("img");
      image.src = backgroundUrl;
      offscreenContainer.appendChild(image);
      document.body.appendChild(offscreenContainer);

      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const cleanup = () => clearTimeout(watchdog);
          const rejectOnce = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
          };
          const complete = (dataUrl: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            translatedImageCacheRef.current.set(pageUrl, dataUrl);
            setCacheRevision((revision) => revision + 1);
            resolve();
          };
          const watchdog = setTimeout(
            () => rejectOnce(new Error("สร้างภาพคำแปลไม่สำเร็จ")),
            30_000,
          );
          void Promise.resolve()
            .then(() =>
              applyTranslationOverlay(
                bubbles,
                "offscreen",
                pageIndex,
                () => {},
                complete,
                textStyleRef,
                offscreenContainer,
              ),
            )
            .catch(rejectOnce);
        });
      } finally {
        image.onload = null;
        image.onerror = null;
        offscreenContainer.remove();
      }

      if (activePageRef.current === pageUrl) {
        setActiveBubbles(bubbles);
        void applyTranslationOverlay(
          bubbles,
          viewMode,
          pageIndex,
          setTranslationResult,
          undefined,
          textStyleRef,
        );
      }
    },
    [viewMode],
  );

  const cacheBackgroundOnly = useCallback(
    async (backgroundUrl: string, pageUrl: string): Promise<void> => {
      const response = await fetch(backgroundUrl);
      if (!response.ok) {
        throw new Error(`ไม่สามารถโหลดรูปภาพคลีนได้ (HTTP ${response.status})`);
      }
      const blob = await response.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("อ่านรูปภาพคลีนไม่สำเร็จ"));
        reader.readAsDataURL(blob);
      });

      translatedImageCacheRef.current.set(pageUrl, dataUrl);
      bubbleCacheRef.current.set(pageUrl, []);
      setCacheRevision((revision) => revision + 1);
      if (activePageRef.current === pageUrl) {
        setActiveBubbles([]);
        setTranslationResult("ไม่พบประโยคที่ต้องแปล");
        setShowTranslate(false);
      }
    },
    [],
  );

  const performTranslation = async (
    preparedPage: PreparedTranslationPage,
    pageUrl: string,
    pageIndex: number,
    forceNsfwBypass: boolean = false,
    isAutoRetry: boolean = false,
  ): Promise<boolean> => {
    try {
      const { recognitionUrl, backgroundUrl } = preparedPage;
      const resImg = await fetch(recognitionUrl);
      if (!resImg.ok) throw new Error(`ไม่สามารถโหลดรูปภาพได้ (HTTP ${resImg.status})`);
      const blob = await resImg.blob();
      const actualMimeType = blob.type && blob.type.startsWith('image/') ? blob.type : "image/jpeg";
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });

      if (nsfwBypassMode || forceNsfwBypass) {
        const imgEl = await waitForImageReady(recognitionUrl);

        const slices = [];
        const rows = 3;
        const cols = 2;
        const baseSliceWidth = imgEl.naturalWidth / cols;
        const baseSliceHeight = imgEl.naturalHeight / rows;
        const overlapX = baseSliceWidth * 0.15;
        const overlapY = baseSliceHeight * 0.15;

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const sx = Math.max(0, col * baseSliceWidth - (col > 0 ? overlapX : 0));
            const sy = Math.max(0, row * baseSliceHeight - (row > 0 ? overlapY : 0));
            const ex = Math.min(imgEl.naturalWidth, (col + 1) * baseSliceWidth + (col < cols - 1 ? overlapX : 0));
            const ey = Math.min(imgEl.naturalHeight, (row + 1) * baseSliceHeight + (row < rows - 1 ? overlapY : 0));
            const sWidth = ex - sx;
            const sHeight = ey - sy;

            const canvas = document.createElement("canvas");
            canvas.width = sWidth;
            canvas.height = sHeight;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(imgEl, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
            const sliceBase64 = canvas.toDataURL("image/jpeg", 0.8).split(",")[1];
            slices.push({ row, col, sx, sy, sWidth, sHeight, base64: sliceBase64 });
          }
        }

        let allBubbles: any[] = [];
        let successCount = 0;
        let validPayloadCount = 0;

        for (let i = 0; i < slices.length; i++) {
          const slice = slices[i];
          setTranslationResult(`กำลังแปลชิ้นส่วนที่ ${i + 1}/6 ...`);
          try {
            const res = await fetch("/api/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageBase64: slice.base64, mimeType: "image/jpeg", targetLang, sourceLang, modelPreference, apiKey: userApiKey })
            });
            const data = await readTranslationResponse<{ text: string }>(res);

            const parsed = parseLLMJSON(data.text);
            if (!parsed || !Array.isArray(parsed.bubbles)) {
              throw new Error("Translation response malformed: bubbles array missing.");
            }
            if (parsed.bubbles.length > 0) {
              const { sx, sy, sWidth, sHeight } = slice;

              for (const b of parsed.bubbles) {
                if (!b.box || b.box.length !== 4) {
                  b.box = [0, 0, 1000, 1000];
                  b.isInvalidBox = true;
                } else if ((b.box[3] - b.box[1] >= 950 && b.box[2] - b.box[0] >= 950) || (b.box[3] === b.box[1] && b.box[2] === b.box[0])) {
                  // Invalid box: shrink to a centered 20% patch so it can't
                  // white-out the whole page; the invalid marker still shows.
                  const cx = (b.box[1] + b.box[3]) / 2;
                  const cy = (b.box[0] + b.box[2]) / 2;
                  b.box = [cy - 100, cx - 100, cy + 100, cx + 100];
                  b.isInvalidBox = true;
                }

                const ymin_px = (b.box[0] / 1000) * sHeight;
                const xmin_px = (b.box[1] / 1000) * sWidth;
                const ymax_px = (b.box[2] / 1000) * sHeight;
                const xmax_px = (b.box[3] / 1000) * sWidth;

                const global_ymin_px = ymin_px + sy;
                const global_xmin_px = xmin_px + sx;
                const global_ymax_px = ymax_px + sy;
                const global_xmax_px = xmax_px + sx;

                b.box[0] = Math.round((global_ymin_px / imgEl.naturalHeight) * 1000);
                b.box[1] = Math.round((global_xmin_px / imgEl.naturalWidth) * 1000);
                b.box[2] = Math.round((global_ymax_px / imgEl.naturalHeight) * 1000);
                b.box[3] = Math.round((global_xmax_px / imgEl.naturalWidth) * 1000);

                let isDuplicate = false;
                // Dedupe against ALL bubbles (invalid boxes too) to stop
                // overlapping white patches stacking on the same spot.
                for (const existing of allBubbles) {
                  const xA = Math.max(b.box[1], existing.box[1]);
                  const yA = Math.max(b.box[0], existing.box[0]);
                  const xB = Math.min(b.box[3], existing.box[3]);
                  const yB = Math.min(b.box[2], existing.box[2]);
                  const interWidth = Math.max(0, xB - xA);
                  const interHeight = Math.max(0, yB - yA);
                  const interArea = interWidth * interHeight;
                  const boxAArea = (b.box[3] - b.box[1]) * (b.box[2] - b.box[0]);
                  const boxBArea = (existing.box[3] - existing.box[1]) * (existing.box[2] - existing.box[0]);
                  const iou = interArea / (boxAArea + boxBArea - interArea);

                  // Containment: if either box covers ≥80% of the other, they
                  // are the same bubble. 60% was too aggressive — adjacent
                  // speech balloons that touch each other were wrongly merged.
                  const bInExisting = boxBArea > 0 && interArea / boxBArea >= 0.8;
                  const existingInB = boxAArea > 0 && interArea / boxAArea >= 0.8;

                  // Centroid distance: only merge when centers are very close
                  // (≤5% of the page). 120/1000 merged distinct adjacent
                  // bubbles that sit side by side.
                  const bCx = (b.box[1] + b.box[3]) / 2;
                  const bCy = (b.box[0] + b.box[2]) / 2;
                  const eCx = (existing.box[1] + existing.box[3]) / 2;
                  const eCy = (existing.box[0] + existing.box[2]) / 2;
                  const dist = Math.hypot(bCx - eCx, bCy - eCy);

                  if (iou > 0.7 || bInExisting || existingInB || dist < 50) {
                    isDuplicate = true;
                    break;
                  }
                }

                if (!isDuplicate) {
                  allBubbles.push(b);
                }
              }
            }
            validPayloadCount++;
            successCount++;
          } catch (err: any) {
            console.warn(`Slice ${i + 1} failed:`, err);
            if (getTranslationRetryDelay(err) !== null) {
              throw err;
            }
          }

          if (i < slices.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (validPayloadCount === 0) {
          throw new Error("Translation failed: no valid NSFW slice responses.");
        }

        // Filter out hallucinated repetitive SFX
        const textCount: Record<string, number> = {};
        const filteredBubbles = [];
        for (const b of allBubbles) {
          const text = (b.t || "").trim();
          textCount[text] = (textCount[text] || 0) + 1;
          // Allow max 3 identical phrases per page to prevent SFX spam
          if (textCount[text] <= 3) {
            filteredBubbles.push(b);
          }
        }
        allBubbles = filteredBubbles;

        const outcome = resolveTranslationOutcome(
          allBubbles,
          getManualBubblesForPage(pageUrl),
        );
        if (outcome.kind === "clean-only") {
          await cacheBackgroundOnly(backgroundUrl, pageUrl);
          return true;
        }

        await renderAndCacheTranslation(
          outcome.bubbles,
          backgroundUrl,
          pageUrl,
          pageIndex,
        );
        bubbleCacheRef.current.set(pageUrl, outcome.bubbles);

        if (activePageRef.current === pageUrl) {
          setTranslationResult(`✅ แปล 18+ สำเร็จ! (ได้ ${successCount}/6 ส่วน)`);
          setShowTranslate(false);
        }
        return true;
      }

      let res: Response;
      try {
        res = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64, mimeType: actualMimeType, targetLang, sourceLang, modelPreference, apiKey: userApiKey })
        });
      } catch (err) {
        // Network-level failure ("Failed to fetch"): transient, retryable.
        throw new TranslationRequestError(
          "Network error: ลองใหม่อีกครั้ง",
          0,
          "NETWORK",
          true,
        );
      }

      const data = await readTranslationResponse<{ text: string }>(res);
      let parsed = data.text ? parseLLMJSON(data.text) : data;
      // Gemini sometimes returns a valid JSON object that omits "bubbles"
      // (e.g. an explanatory reply or an empty-scan response). Treat that as
      // "no text found" instead of a hard failure so the page can fall
      // through to clean-only / auto-retry handling below.
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Translation response malformed: invalid JSON.");
      }
      if (!Array.isArray(parsed.bubbles)) {
        parsed = { ...parsed, bubbles: [] };
      }

      if (
        parsed.bubbles.length === 0
        && !isAutoRetry
        && !nsfwBypassMode
        && !forceNsfwBypass
      ) {
        console.log(`[Auto-Retry] 0 bubbles found for page ${pageIndex + 1}. Retrying with enhanced single image...`);
        if (activePageRef.current === pageUrl) {
          setTranslationResult("⏳ ไม่พบข้อความ! กำลังปรับความคมชัดภาพและ Auto-Retry...");
        }

        const imgEl = await waitForImageReady(recognitionUrl);
        const canvas = document.createElement("canvas");
        canvas.width = imgEl.naturalWidth;
        canvas.height = imgEl.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          throw new Error("Translation failed: enhanced image canvas unavailable.");
        }
        ctx.filter = "contrast(1.35) brightness(1.05)";
        ctx.drawImage(imgEl, 0, 0);
        const enhancedBase64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
        if (!enhancedBase64) {
          throw new Error("Translation failed: enhanced image encoding failed.");
        }

        const retryRes = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageBase64: enhancedBase64,
            mimeType: "image/jpeg",
            targetLang,
            sourceLang,
            modelPreference,
            apiKey: userApiKey,
            isRetry: true
          })
        });
        const retryData =
          await readTranslationResponse<{ text: string }>(retryRes);
        const retryParsed = retryData.text
          ? parseLLMJSON(retryData.text)
          : retryData;
        if (!retryParsed || !Array.isArray(retryParsed.bubbles)) {
          throw new Error("Translation retry response malformed: bubbles array missing.");
        }
        parsed = retryParsed;
      }

      // Filter out hallucinated repetitive SFX
      const textCount: Record<string, number> = {};
      const filteredParsed = [];
      for (const b of parsed.bubbles) {
        const text = (b.t || "").trim();
        textCount[text] = (textCount[text] || 0) + 1;
        if (textCount[text] <= 3) {
          filteredParsed.push(b);
        }
      }

      const outcome = resolveTranslationOutcome(
        filteredParsed,
        getManualBubblesForPage(pageUrl),
      );
      if (outcome.kind === "clean-only") {
        await cacheBackgroundOnly(backgroundUrl, pageUrl);
        return true;
      }

      await renderAndCacheTranslation(
        outcome.bubbles,
        backgroundUrl,
        pageUrl,
        pageIndex,
      );
      bubbleCacheRef.current.set(pageUrl, outcome.bubbles);

      if (activePageRef.current === pageUrl) {
        setTranslationResult("✅ แปลสำเร็จ! ข้อความถูกวาดทับลงบนภาพแล้ว");
        setShowTranslate(false);
      }

      return true;
    } catch (error: any) {
      if (activePageRef.current === pageUrl) {
        setTranslationResult("❌ Error: " + error.message);
      }
      throw error; // Rethrow so the caller can handle 429
    }
  };

  const handleTranslate = async (
    _forceBypassCache: boolean = false,
  ): Promise<boolean> => {
    if (
      translationOperationLockRef.current ||
      isTranslating ||
      isTranslatingAll ||
      pages.length === 0
    ) return false;
    translationOperationLockRef.current = true;
    const pageUrl = pages[currentPage];

    setIsTranslating(true);
    try {
      setWorkflowPhase("cleaning");
      setTranslationResult(
        `กำลังคลีนหน้า ${currentPage + 1}/${pages.length}`,
      );
      const preparedPage = await preparePageForTranslation(pageUrl, currentPage);
      setWorkflowPhase("translating");
      setTranslationResult(
        `กำลังแปลหน้า ${currentPage + 1}/${pages.length}`,
      );
      return await performTranslation(
        preparedPage,
        pageUrl,
        currentPage,
        nsfwBypassMode,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "ดำเนินการไม่สำเร็จ";
      setTranslationResult(`❌ Error: ${message}`);
      return false;
    } finally {
      translationOperationLockRef.current = false;
      setWorkflowPhase(null);
      setIsTranslating(false);
      setTimeout(() => setTranslationResult(null), 4000);
    }
  };

  const handleTranslateAll = async () => {
    if (
      translationOperationLockRef.current ||
      isTranslating ||
      isTranslatingAll
    ) return;
    translationOperationLockRef.current = true;
    try {
      setIsTranslatingAll(true);
      cancelTranslateAllRef.current = false;
      const batchStartTime = Date.now();
      const failures: BatchPageFailure[] = [];
      let quotaFailureMessage: string | null = null;
      setBatchFailures([]);

      const interruptibleDelay = async (ms: number) => {
        const endTime = Date.now() + ms;
        while (Date.now() < endTime) {
          if (cancelTranslateAllRef.current) return;
          await new Promise(r => setTimeout(r, 1000));
        }
      };

      for (let i = 0; i < pages.length; i++) {
        if (cancelTranslateAllRef.current) break;
        const pageUrl = pages[i];

        // Skip if already translated (check cache)
        if (translatedImageCacheRef.current.has(pages[i])) continue;

        setTranslateAllProgress({
          current: i + 1,
          total: pages.length,
          status: "cleaning",
          message: `กำลังคลีนหน้า ${i + 1}/${pages.length}`,
          startTime: batchStartTime,
        });

        let preparedPage: PreparedTranslationPage;
        try {
          preparedPage = await preparePageForTranslation(pageUrl, i);
        } catch (error) {
          failures.push({
            pageIndex: i,
            pageUrl,
            stage: "cleaning",
            message: error instanceof Error ? error.message : "คลีนไม่สำเร็จ",
          });
          setBatchFailures([...failures]);
          continue;
        }
        if (cancelTranslateAllRef.current) break;

        setTranslateAllProgress({
          current: i + 1,
          total: pages.length,
          status: "translating",
          message: `กำลังแปลหน้า ${i + 1}/${pages.length}`,
          startTime: batchStartTime,
        });

        let success = false;
        let retries = 0;
        let forceNsfw = false;
        let lastTranslationError: unknown;

        while (!success && retries < 3 && !cancelTranslateAllRef.current) {
          try {
            // Temporarily set translationResult so user sees progress
            if (nsfwBypassMode || forceNsfw) setTranslationResult(`กำลังหั่นภาพเป็น 6 ส่วน (หน้า ${i + 1}) - รอบ ${retries + 1}/3`);
            else setTranslationResult(`กำลังประมวลผลด้วย AI (หน้า ${i + 1}) - รอบ ${retries + 1}/3`);

            success = await performTranslation(
              preparedPage,
              pageUrl,
              i,
              forceNsfw,
            );

            if (!success) throw new Error("Translation failed");
          } catch (err: any) {
            lastTranslationError = err;
            const errMsg = err.message || "";
            const retryDelay = getTranslationRetryDelay(err);
            console.warn(`Error on page ${i + 1}, retry ${retries + 1}/3:`, errMsg);

            if (retryDelay === null) {
              setTranslationResult(`แปลไม่สำเร็จ: ${errMsg}`);
              break;
            }
            if (
              err instanceof TranslationRequestError
              && err.code === "GEMINI_QUOTA"
            ) {
              setTranslateAllProgress({ current: i + 1, total: pages.length, status: "waiting", message: `รอโควต้า API (60 วิ)... หน้า ${i + 1}/${pages.length}`, startTime: batchStartTime });
              setTranslationResult(`API Limit Reached! รอ 60 วิ... (รอบ ${retries + 1}/3)`);
            } else {
              setTranslationResult(`แปลไม่ผ่าน รอ 5 วิเพื่อลองใหม่... (รอบ ${retries + 1}/3)`);
            }
            await interruptibleDelay(retryDelay);
            retries++;
          }
        }

        if (!success && !cancelTranslateAllRef.current) {
          failures.push({
            pageIndex: i,
            pageUrl,
            stage: "translation",
            message:
              lastTranslationError instanceof Error
                ? lastTranslationError.message
                : "แปลไม่สำเร็จ",
          });
          setBatchFailures([...failures]);
        }

        if (
          lastTranslationError instanceof TranslationRequestError
          && lastTranslationError.code === "GEMINI_QUOTA"
        ) {
          quotaFailureMessage =
            "❌ โควต้า API เต็ม กรุณารอให้โควต้ารีเซ็ตแล้วลองใหม่";
          break;
        }

        if (!success) {
          console.warn(`Skipping page ${i + 1} after 3 failed attempts.`);
          if (retries >= 3 && translatedImageCacheRef.current.size === 0 && i > 0) {
             // We could check if it's a persistent quota error, but if a page fails 3 times,
             // maybe we shouldn't abort entirely unless we track the error.
          }
        }

        if (!success) {
          console.warn(`Translation failed for page ${i + 1} after 3 attempts.`);
          const lastMsg = translationResult || "";
          if (lastMsg.includes("API Limit Reached") || lastMsg.includes("โควต้า")) {
             setTranslationResult(`❌ โควต้า API เต็ม! กรุณารอรีเซ็ต (หากเป็นโควต้ารายวันจะรีเซ็ตตอน 14:00 น.)`);
             break; // Abort Translate All
          }
        }

        if (success && i < pages.length - 1 && !cancelTranslateAllRef.current) {
          setTranslateAllProgress({ current: i + 1, total: pages.length, status: "cooldown", message: `พักโหลด 3 วิ... หน้า ${i + 1}/${pages.length}`, startTime: batchStartTime });
          await interruptibleDelay(3000);
        }
      }

      if (cancelTranslateAllRef.current) return;

      const failedPages = failures.map(({ pageIndex }) => pageIndex + 1);
      setTranslationResult(
        quotaFailureMessage
          ?? (failedPages.length === 0
            ? "✅ แปลทั้งเล่มเสร็จแล้ว"
            : `⚠️ แปลเสร็จ แต่หน้า ${failedPages.join(", ")} ต้องลองใหม่`),
      );
      setTimeout(() => setTranslationResult(null), 4000);
    } finally {
      translationOperationLockRef.current = false;
      setIsTranslatingAll(false);
      setTranslateAllProgress(null);
    }
  };

  const cancelTranslateAll = () => {
    cancelTranslateAllRef.current = true;
    setTranslationResult("⏹ กำลังยกเลิก...");
  };

  const invalidatePageTranslation = useCallback((pageUrl: string) => {
    bubbleCacheRef.current.delete(pageUrl);
    translatedImageCacheRef.current.delete(pageUrl);
    setCacheRevision((revision) => revision + 1);
    if (activePageRef.current === pageUrl) setActiveBubbles([]);
  }, []);

  return {
    targetLang, setTargetLang,
    sourceLang, setSourceLang,
    modelPreference, setModelPreference,
    textStyle, setTextStyle,
    nsfwBypassMode, setNsfwBypassMode,
    isTranslating,
    translationResult, setTranslationResult,
    showTranslate, setShowTranslate,
    handleTranslate,
    isTranslatingAll,
    translateAllProgress,
    handleTranslateAll,
    cancelTranslateAll,
    translateCrop,
    activeBubbles, setActiveBubbles,
    translatedImageCacheRef,
    bubbleCacheRef,
    textStyleRef,
    userApiKey,
    setUserApiKey: (key: string) => {
      setUserApiKey(key);
      if (key) localStorage.setItem("gemini_api_key", key);
      else localStorage.removeItem("gemini_api_key");
    },
    restoreSavedSession,
    clearSavedSession,
    workflowPhase,
    batchFailures,
    invalidatePageTranslation,
  };
}
