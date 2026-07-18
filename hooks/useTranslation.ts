import { useState, useRef, useEffect, useCallback } from "react";
import { applyTranslationOverlay } from "@/lib/translationOverlay";

const parseLLMJSON = (text: string) => {
  if (!text) return null;
  try {
    const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    try {
       let clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
       // Fix trailing commas
       clean = clean.replace(/,\s*([\]}])/g, '$1');
       
       if (!clean.endsWith("}")) {
          const lastBrace = clean.lastIndexOf("}");
          if (lastBrace !== -1) {
             clean = clean.substring(0, lastBrace + 1) + "]}";
             return JSON.parse(clean);
          }
       }
       return JSON.parse(clean);
    } catch (e2) {
       return null;
    }
  }
};

interface UseTranslationProps {
  currentPage: number;
  pages: string[];
  viewMode: "single" | "scroll";
}

export function useTranslation({ currentPage, pages, viewMode }: UseTranslationProps) {
  const [isTranslatingAll, setIsTranslatingAll] = useState(false);
  const [translateAllProgress, setTranslateAllProgress] = useState<{
    current: number;
    total: number;
    status: "translating" | "waiting" | "cooldown";
    message: string;
    startTime: number;
  } | null>(null);
  const cancelTranslateAllRef = useRef(false);
  
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

  // When currentPage changes, restore cached bubbles and re-apply overlay
  useEffect(() => {
    if (pages.length === 0) return;
    const currentKey = pages[currentPage];
    const cached = bubbleCacheRef.current.get(currentKey);
    if (cached && cached.length > 0) {
      setActiveBubbles(cached);
      // Small delay so the DOM (pageContainer + img) is rendered first
      const timer = setTimeout(() => {
        applyTranslationOverlay(cached, viewMode, currentPage, setTranslationResult, (dataUrl) => {
          translatedImageCacheRef.current.set(currentKey, dataUrl);
        }, textStyleRef);
      }, 100);
      return () => clearTimeout(timer);
    } else {
      setActiveBubbles([]);
    }
  }, [currentPage, pages, viewMode]);

  // Helper to save bubbles to cache AND state
  const saveBubbles = useCallback((pageKey: string, bubbles: any[]) => {
    bubbleCacheRef.current.set(pageKey, bubbles);
    setActiveBubbles(bubbles);
  }, []);

  const translateCrop = async (cropBox: { x: number, y: number, w: number, h: number }, cropBase64: string, fullWidth: number, fullHeight: number) => {
    setIsTranslating(true);
    setTranslationResult("กำลังแปลเฉพาะจุดที่เลือก...");
    try {
      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: cropBase64, mimeType: "image/jpeg", targetLang, sourceLang, modelPreference, apiKey: userApiKey })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
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

  const performTranslation = async (pageUrl: string, pageIndex: number, forceNsfwBypass: boolean = false): Promise<boolean> => {
    try {
      const resImg = await fetch(pageUrl);
      if (!resImg.ok) throw new Error(`ไม่สามารถโหลดรูปภาพได้ (HTTP ${resImg.status})`);
      const blob = await resImg.blob();
      const actualMimeType = blob.type && blob.type.startsWith('image/') ? blob.type : "image/jpeg";
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });

      if (nsfwBypassMode || forceNsfwBypass) {
        const imgEl = new Image();
        imgEl.src = pageUrl;
        await new Promise(r => { imgEl.onload = r; });

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

        for (let i = 0; i < slices.length; i++) {
          const slice = slices[i];
          setTranslationResult(`กำลังแปลชิ้นส่วนที่ ${i + 1}/6 ...`);
          try {
            const res = await fetch("/api/translate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ imageBase64: slice.base64, mimeType: "image/jpeg", targetLang, sourceLang, modelPreference, apiKey: userApiKey })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error);
            
            const parsed = parseLLMJSON(data.text);
            if (parsed.bubbles) {
              successCount++;
              const { sx, sy, sWidth, sHeight } = slice;
              
              for (const b of parsed.bubbles) {
                if (!b.box || b.box.length !== 4) {
                  b.box = [0, 0, 1000, 1000];
                  b.isInvalidBox = true;
                } else if ((b.box[3] - b.box[1] >= 950 && b.box[2] - b.box[0] >= 950) || (b.box[3] === b.box[1] && b.box[2] === b.box[0])) {
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
                if (!b.isInvalidBox) {
                  for (const existing of allBubbles) {
                    if (existing.isInvalidBox) continue;
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
                    
                    if (iou > 0.4) {
                      isDuplicate = true;
                      break;
                    }
                  }
                }
                
                if (!isDuplicate) {
                  allBubbles.push(b);
                }
              }
            }
          } catch (err: any) {
            console.warn(`Slice ${i + 1} failed:`, err);
            if (err.message && (err.message.includes("429") || err.message.includes("โควต้าเต็ม"))) {
              throw err;
            }
          }
          
          if (i < slices.length - 1) {
            await new Promise(r => setTimeout(r, 1000));
          }
        }

        if (allBubbles.length === 0) {
          throw new Error(`แปลไม่สำเร็จ หรือโควต้าเต็ม (ผ่านการตรวจสอบ: ${successCount}/6 ชิ้น)`);
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

        const manualBubbles = activeBubbles.filter(b => b.isManual);
        const finalBubbles = [...allBubbles, ...manualBubbles];

        bubbleCacheRef.current.set(pageUrl, allBubbles);
        
        if (activePageRef.current === pageUrl) {
          setActiveBubbles(allBubbles);
          applyTranslationOverlay(allBubbles, viewMode, pageIndex, setTranslationResult, (dataUrl) => {
            translatedImageCacheRef.current.set(pageUrl, dataUrl);
          }, textStyleRef);
          setTranslationResult(`✅ แปล 18+ สำเร็จ! (ได้ ${successCount}/6 ส่วน)`);
          setShowTranslate(false);
        }
        return true;
      }

      const res = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, mimeType: actualMimeType, targetLang, sourceLang, modelPreference, apiKey: userApiKey })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to translate");
      
      let parsed = data.text ? parseLLMJSON(data.text) : data;
      
      if (!parsed || !Array.isArray(parsed.bubbles)) { 
        throw new Error("ไม่พบข้อความในหน้านี้"); 
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

      const manualBubbles = activeBubbles.filter(b => b.isManual);
      const finalBubbles = [...filteredParsed, ...manualBubbles];

      bubbleCacheRef.current.set(pageUrl, finalBubbles);
      
      if (activePageRef.current === pageUrl) {
        setActiveBubbles(finalBubbles);
        applyTranslationOverlay(finalBubbles, viewMode, pageIndex, setTranslationResult, (dataUrl) => {
          translatedImageCacheRef.current.set(pageUrl, dataUrl);
        }, textStyleRef);
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

  const handleTranslate = async (forceBypassCache: boolean = false) => {
    if (pages.length === 0) return;
    const requestedPageUrl = pages[currentPage];
    
    setIsTranslating(true);
    if (nsfwBypassMode) {
      setTranslationResult("กำลังหั่นภาพเป็น 6 ส่วน เพื่อส่งให้ AI แปลพร้อมกัน...");
    } else {
      setTranslationResult("กำลังประมวลผลด้วย AI (อาจใช้เวลา 15-40 วินาที)...");
    }

    try {
      await performTranslation(requestedPageUrl, currentPage);
    } catch (error: any) {
      // Error is already logged in performTranslation if active
    } finally {
      setIsTranslating(false);
      setTimeout(() => setTranslationResult(null), 4000);
    }
  };

  const handleTranslateAll = async () => {
    setIsTranslatingAll(true);
    cancelTranslateAllRef.current = false;
    const batchStartTime = Date.now();
    
    const interruptibleDelay = async (ms: number) => {
      const steps = ms / 100;
      for (let i = 0; i < steps; i++) {
        if (cancelTranslateAllRef.current) return;
        await new Promise(r => setTimeout(r, 100));
      }
    };
    
    for (let i = 0; i < pages.length; i++) {
      if (cancelTranslateAllRef.current) break;
      
      // Skip if already translated (check cache)
      if (translatedImageCacheRef.current.has(pages[i])) continue;
      
      setTranslateAllProgress({ current: i + 1, total: pages.length, status: "translating", message: `กำลังแปลหน้า ${i + 1}/${pages.length}`, startTime: batchStartTime });
      
      let success = false;
      let retries = 0;
      let forceNsfw = false;
      
      while (!success && retries < 3 && !cancelTranslateAllRef.current) {
        try {
          // Temporarily set translationResult so user sees progress
          if (nsfwBypassMode || forceNsfw) setTranslationResult(`กำลังหั่นภาพเป็น 6 ส่วน (หน้า ${i + 1}) - รอบ ${retries + 1}/3`);
          else setTranslationResult(`กำลังประมวลผลด้วย AI (หน้า ${i + 1}) - รอบ ${retries + 1}/3`);
          
          success = await performTranslation(pages[i], i, forceNsfw);
          
          if (!success) throw new Error("Translation failed");
        } catch (err: any) {
          const errMsg = err.message || "";
          console.warn(`Error on page ${i + 1}, retry ${retries + 1}/3:`, errMsg);
          
          if (errMsg.includes("429") || errMsg.includes("โควต้าเต็ม") || errMsg.includes("Failed")) {
            setTranslateAllProgress({ current: i + 1, total: pages.length, status: "waiting", message: `รอโควต้า API (30 วิ)... หน้า ${i + 1}/${pages.length}`, startTime: batchStartTime });
            setTranslationResult(`API Limit Reached! รอ 30 วิ... (รอบ ${retries + 1}/3)`);
            await interruptibleDelay(30000);
          } else {
            // Other error (Censorship, parse error, no text)
            // Smart Retry: auto fallback to 18+ mode if not already using it
            if (!nsfwBypassMode && !forceNsfw) {
              forceNsfw = true;
              setTranslationResult(`แปลไม่ผ่าน ลองเปิดโหมด 18+ อัตโนมัติ...`);
              await interruptibleDelay(2000);
            } else {
              setTranslationResult(`แปลไม่ผ่าน รอ 5 วิเพื่อลองใหม่... (รอบ ${retries + 1}/3)`);
              await interruptibleDelay(5000);
            }
          }
          retries++;
        }
      }
      
      if (!success) {
        console.warn(`Skipping page ${i + 1} after 3 failed attempts.`);
      }
      
      if (success && i < pages.length - 1 && !cancelTranslateAllRef.current) {
        setTranslateAllProgress({ current: i + 1, total: pages.length, status: "cooldown", message: `พักโหลด 3 วิ... หน้า ${i + 1}/${pages.length}`, startTime: batchStartTime });
        await interruptibleDelay(3000);
      }
    }
    
    if (cancelTranslateAllRef.current) return;
    
    setIsTranslatingAll(false);
    setTranslateAllProgress(null);
    setTranslationResult("✅ แปลทั้งหมดเสร็จสิ้น!");
    setTimeout(() => setTranslationResult(null), 4000);
  };

  const cancelTranslateAll = () => {
    cancelTranslateAllRef.current = true;
    setIsTranslatingAll(false);
    setTranslateAllProgress(null);
    setTranslationResult("⏹ ยกเลิกการแปลทั้งหมด");
    setTimeout(() => setTranslationResult(null), 4000);
  };

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
    }
  };
}
