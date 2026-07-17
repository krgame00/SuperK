"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useTranslation } from "@/hooks/useTranslation";
import { jsPDF } from "jspdf";
import { Toaster } from "react-hot-toast";
import { downloadTranslatedImage } from "@/lib/translationOverlay";
import { Upload, ChevronLeft, ChevronRight, Wand2, Download, Archive, Flame, Eye, EyeOff, Undo2, Redo2, Trash2 } from "lucide-react";
import { undoManager } from "@/lib/undoManager";
import JSZip from "jszip";

export default function WorkspacePage() {
  const [pages, setPages] = useState<{url: string, name: string}[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const thumbnailContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = thumbnailContainerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        container.scrollLeft += e.deltaY;
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pages.length]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dragPosition, setDragPosition] = useState<'left' | 'right' | null>(null);
  
  // Settings Modal State
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pageUrls = useMemo(() => pages.map(p => p.url), [pages]);

  const {
    targetLang,
    setTargetLang,
    isTranslating,
    translationResult,
    handleTranslate,
    isTranslatingAll,
    translateAllProgress,
    handleTranslateAll,
    cancelTranslateAll,
    activeBubbles,
    setActiveBubbles,
    translateCrop,
    nsfwBypassMode,
    setNsfwBypassMode,
    translatedImageCacheRef,
    userApiKey,
    setUserApiKey,
    modelPreference,
    setModelPreference,
    sourceLang,
    setSourceLang,
    textStyle,
    setTextStyle
  } = useTranslation({
    currentPage,
    pages: pageUrls,
    viewMode: "single"
  });

  // Keyboard shortcuts refs (to access latest state from event listener closure)
  const currentPageRef = useRef(currentPage);
  const pagesRef = useRef(pages);
  const showOriginalRef = useRef(showOriginal);
  const isTranslatingRef = useRef(isTranslating);
  useEffect(() => { currentPageRef.current = currentPage; }, [currentPage]);
  useEffect(() => { pagesRef.current = pages; }, [pages]);
  useEffect(() => { showOriginalRef.current = showOriginal; }, [showOriginal]);
  useEffect(() => { isTranslatingRef.current = isTranslating; }, [isTranslating]);

  // Keyboard shortcuts + Undo/Redo state sync
  useEffect(() => {
    const syncState = () => {
      setCanUndo(undoManager.canUndo());
      setCanRedo(undoManager.canRedo());
    };
    const unsub = undoManager.onChange(syncState);

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      // Undo: Ctrl+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const label = undoManager.undo();
        if (label) import('react-hot-toast').then(m => m.default(`↩️ Undo: ${label}`, { duration: 1500 }));
        return;
      }
      // Redo: Ctrl+Shift+Z / Ctrl+Y
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        const label = undoManager.redo();
        if (label) import('react-hot-toast').then(m => m.default(`↪️ Redo: ${label}`, { duration: 1500 }));
        return;
      }

      // Don't trigger shortcuts when modifier keys are held (except for undo/redo above)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // ← Previous page
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setCurrentPage(p => Math.max(0, p - 1));
      }
      // → Next page
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentPage(p => Math.min(pagesRef.current.length - 1, p + 1));
      }
      // T = Translate current page
      if (e.key === 't' || e.key === 'T') {
        if (!isTranslatingRef.current && pagesRef.current.length > 0) {
          handleTranslate();
        }
      }
      // Space = Toggle Original/Translated
      if (e.key === ' ') {
        e.preventDefault();
        setShowOriginal(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => { window.removeEventListener('keydown', handleKeyDown); unsub(); };
  }, [handleTranslate]);

  // Clear undo stack when changing pages
  useEffect(() => { undoManager.clear(); }, [currentPage]);

  const handleDownloadAll = async (format: "zip" | "cbz" | "pdf" = "zip") => {
    if (pages.length === 0) return;
    setIsZipping(true);
    
    if (format === "pdf") {
      try {
        const pdf = new jsPDF({ orientation: "portrait", unit: "px" });
        for (let i = 0; i < pages.length; i++) {
          let dataUrl = pages[i].url; // Default to original
          
          if (i === currentPage && !showOriginal && activeBubbles.length > 0) {
            const currentDataUrl = downloadTranslatedImage("single", i, "", true);
            if (currentDataUrl) dataUrl = currentDataUrl;
          } 
          else if (translatedImageCacheRef.current.has(pages[i].url)) {
            dataUrl = translatedImageCacheRef.current.get(pages[i].url) as string;
          }
          
          const img = new Image();
          img.src = dataUrl;
          await new Promise(r => { img.onload = r; });
          
          const orientation = img.naturalWidth > img.naturalHeight ? "l" : "p";
          if (i > 0) pdf.addPage([img.naturalWidth, img.naturalHeight], orientation);
          else pdf.setPage(1);
          
          if (i === 0) {
            pdf.deletePage(1);
            pdf.addPage([img.naturalWidth, img.naturalHeight], orientation);
          }
          
          pdf.addImage(dataUrl, "JPEG", 0, 0, img.naturalWidth, img.naturalHeight);
        }
        pdf.save("SuperK_Translations.pdf");
      } catch (e) {
        console.error("Failed to generate PDF", e);
      } finally {
        setIsZipping(false);
      }
      return;
    }
    
    const zip = new JSZip();
    
    for (let i = 0; i < pages.length; i++) {
      let dataUrl = pages[i].url; // Default to original
      
      // If the current page is being viewed, grab its latest canvas output
      if (i === currentPage && !showOriginal && activeBubbles.length > 0) {
        const currentDataUrl = downloadTranslatedImage("single", i, "", true);
        if (currentDataUrl) dataUrl = currentDataUrl;
      } 
      // Otherwise, use cached translated image if available
      else if (translatedImageCacheRef.current.has(pages[i].url)) {
        dataUrl = translatedImageCacheRef.current.get(pages[i].url) as string;
      }
      
      // Remove data:image/png;base64, prefix
      const base64Data = dataUrl.split(",")[1];
      
      const originalName = pages[i].name;
      const extension = originalName.includes('.') ? originalName.split('.').pop() : 'png';
      const baseName = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
      // zero pad the index for better sorting in OS file explorer
      const filename = `SuperK_Page_${String(i + 1).padStart(3, '0')}_${baseName}.${extension}`;
      zip.file(filename, base64Data, { base64: true });
    }
    
    try {
      const content = await zip.generateAsync({ type: "blob" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(content);
      link.download = format === "cbz" ? "SuperK_Translations.cbz" : "SuperK_Translations.zip";
      link.click();
    } catch (e) {
      console.error(`Failed to generate ${format}`, e);
    } finally {
      setIsZipping(false);
    }
  };

  const processFiles = async (files: File[]) => {
    // Natural sort: "page1, page2, page10" instead of "page1, page10, page2"
    const sorted = [...files].sort((a, b) => 
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    const newPages: {url: string, name: string}[] = [];
    for (const file of sorted) {
      if (!file.type.startsWith("image/")) continue;
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = (event) => resolve(event.target?.result as string);
        reader.readAsDataURL(file);
      });
      newPages.push({ url: base64, name: file.name });
    }
    
    if (newPages.length > 0) {
      setPages(prev => {
        const updated = [...prev, ...newPages];
        if (prev.length === 0) {
          setCurrentPage(0);
          setActiveBubbles([]);
        }
        return updated;
      });
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    await processFiles(files);
    e.target.value = ''; // Reset input
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
  };

  return (
    <div 
      className="min-h-screen bg-background text-foreground flex flex-col font-sans"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Toaster position="top-center" toastOptions={{
        style: {
          background: 'var(--surface)',
          color: 'var(--foreground)',
          border: '1px solid var(--surface-hover)',
        },
      }} />
      
      {/* Batch Progress Bar - Full Width */}
      {translateAllProgress && (
        <div className="fixed top-16 left-0 right-0 z-50">
          <div className="h-1 bg-surface w-full">
            <div 
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${(translateAllProgress.current / translateAllProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Header Panel */}
      <header className="w-full bg-background/80 backdrop-blur-md border-b border-surface-hover h-16 flex justify-between items-center px-6 z-50 fixed top-0">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-medium tracking-tight text-foreground">
            Super<span className="text-primary">K</span>
          </h1>
          <span className="text-muted text-sm hidden sm:inline-block pl-3 border-l border-surface-hover">Manga Translator</span>
        </div>
        
        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="relative flex-shrink-0">
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className="px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors duration-150 text-muted hover:text-foreground hover:bg-surface"
              title="Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            </button>

            {/* Simple Settings Modal */}
            {isSettingsOpen && (
              <div id="settings-modal" className="fixed inset-x-4 top-16 sm:absolute sm:inset-auto sm:right-0 sm:top-12 sm:mt-2 w-auto sm:w-80 max-w-sm bg-surface/95 backdrop-blur-xl border border-surface-hover rounded-xl shadow-2xl p-4 z-[100] max-h-[80vh] overflow-y-auto mx-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-medium text-foreground">Settings</h3>
                  <button onClick={() => setIsSettingsOpen(false)} className="text-muted hover:text-foreground">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                  </button>
                </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Source Language (ภาษาต้นฉบับ)</label>
                  <select
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value)}
                    className="w-full bg-background border border-surface-hover rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                  >
                    <option value="auto">Auto Detect (ตรวจจับอัตโนมัติ)</option>
                    <option value="Japanese">🇯🇵 Japanese (ญี่ปุ่น)</option>
                    <option value="Korean">🇰🇷 Korean (เกาหลี)</option>
                    <option value="Chinese">🇨🇳 Chinese (จีน)</option>
                    <option value="English">🇬🇧 English (อังกฤษ)</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-surface-hover">
                  <label className="block text-xs font-medium text-muted mb-2">Text Style (รูปแบบข้อความแปล)</label>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Font Family</span>
                      <select
                        value={textStyle.fontFamily}
                        onChange={(e) => setTextStyle({ ...textStyle, fontFamily: e.target.value })}
                        className="bg-background border border-surface-hover rounded px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-32"
                      >
                        <option value="Itim, cursive">Itim (การ์ตูน)</option>
                        <option value="Prompt, sans-serif">Prompt (อ่านง่าย)</option>
                        <option value="Kanit, sans-serif">Kanit (โมเดิร์น)</option>
                        <option value="Sarabun, sans-serif">Sarabun (ทางการ)</option>
                      </select>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Text Color</span>
                      <input 
                        type="color" 
                        value={textStyle.textColor}
                        onChange={(e) => setTextStyle({ ...textStyle, textColor: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                      />
                    </div>

                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted">Outline Color</span>
                      <input 
                        type="color" 
                        value={textStyle.textOutline}
                        onChange={(e) => setTextStyle({ ...textStyle, textOutline: e.target.value })}
                        className="w-8 h-8 rounded cursor-pointer border-0 p-0 bg-transparent"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-sm text-muted">
                        <span>Font Size Multiplier</span>
                        <span>{textStyle.fontSizeMultiplier.toFixed(1)}x</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.5" max="2.0" step="0.1"
                        value={textStyle.fontSizeMultiplier}
                        onChange={(e) => setTextStyle({ ...textStyle, fontSizeMultiplier: parseFloat(e.target.value) })}
                        className="w-full accent-primary"
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-surface-hover">
                  <label className="block text-xs font-medium text-muted mb-1">Model Preference</label>
                  <select
                    value={modelPreference}
                    onChange={(e) => setModelPreference(e.target.value)}
                    className="w-full bg-background border border-surface-hover rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary appearance-none"
                  >
                    <option value="auto">Auto (สลับโมเดลอัตโนมัติเมื่อโควต้าเต็ม)</option>
                    <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                    <option value="gemini-3-flash">Gemini 3.0 Flash</option>
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                    <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                    <option value="gemini-2.5-flash-lite">Gemini 2.5 Flash Lite</option>
                  </select>
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-muted mb-1">Gemini API Key (Optional)</label>
                  <input 
                    type="password" 
                    value={userApiKey}
                    onChange={(e) => setUserApiKey(e.target.value)}
                    placeholder="AIzaSy..." 
                    className="w-full bg-background border border-surface-hover rounded-md px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  <p className="text-[10px] text-muted mt-1 leading-relaxed">
                    By default, the app uses a shared key with limits (5 req/min). 
                    To avoid "Quota exceeded" errors (especially in 18+ mode), enter your own free Gemini API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-primary hover:underline">Google AI Studio</a>.
                  </p>
                </div>

              </div>
            </div>
            )}
          </div>

          <button
            onClick={() => setNsfwBypassMode(!nsfwBypassMode)}
            className={`flex-shrink-0 px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors duration-150 ${nsfwBypassMode ? 'text-primary bg-primary/10' : 'text-muted hover:text-foreground hover:bg-surface'}`}
            title="Slice image to bypass AI censorship"
          >
            <Flame className="w-4 h-4" />
            <span className="hidden sm:inline">18+ Mode</span>
          </button>
          
          <button
            onClick={() => setShowOriginal(!showOriginal)}
            disabled={activeBubbles.length === 0}
            className={`flex-shrink-0 px-2 sm:px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors duration-150 border border-transparent ${showOriginal ? 'text-primary bg-primary/10 border-primary/20' : 'text-muted hover:text-foreground hover:bg-surface'}`}
            title="Toggle original image"
          >
            {showOriginal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            <span className="hidden lg:inline">{showOriginal ? 'Show Translation' : 'View Original'}</span>
          </button>

          {/* Undo/Redo Buttons */}
          <div className="flex-shrink-0 flex items-center gap-1 border-l border-surface-hover pl-1.5 sm:pl-3 ml-0 sm:ml-1">
            <button
              onClick={() => {
                const label = undoManager.undo();
                if (label) import('react-hot-toast').then(m => m.default(`↩️ Undo: ${label}`, { duration: 1500 }));
              }}
              disabled={!canUndo}
              className="px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-colors duration-150 text-muted hover:text-foreground hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent"
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                const label = undoManager.redo();
                if (label) import('react-hot-toast').then(m => m.default(`↪️ Redo: ${label}`, { duration: 1500 }));
              }}
              disabled={!canRedo}
              className="px-2 py-1.5 rounded-md text-sm font-medium flex items-center gap-1 transition-colors duration-150 text-muted hover:text-foreground hover:bg-surface disabled:opacity-30 disabled:hover:bg-transparent"
              title="Redo (Ctrl+Shift+Z)"
            >
              <Redo2 className="w-4 h-4" />
            </button>
          </div>
          
          <button 
            onClick={() => handleTranslate()}
            disabled={isTranslating || pages.length === 0}
            className="flex-shrink-0 bg-primary text-primary-content hover:bg-primary-hover disabled:opacity-50 disabled:hover:bg-primary px-3 sm:px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors duration-150"
          >
            {isTranslating ? (
              <span className="flex items-center gap-1.5 sm:gap-2">
                <span className="animate-spin h-3 w-3 border-2 border-primary-content border-t-transparent rounded-full"></span>
                <span className="hidden md:inline">Translating</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 sm:gap-2">
                <Wand2 className="w-4 h-4" />
                <span className="hidden md:inline">Translate</span>
              </span>
            )}
          </button>

          {isTranslatingAll ? (
            <div className="flex-shrink-0 flex items-center gap-2 sm:gap-3">
              <div className="flex items-center gap-2 text-sm text-primary font-medium">
                <span className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full"></span>
                <span className="hidden sm:inline">{translateAllProgress?.message || 'กำลังเตรียม...'}</span>
                {translateAllProgress && translateAllProgress.current > 1 && (() => {
                  const elapsed = (Date.now() - translateAllProgress.startTime) / 1000;
                  const avgPerPage = elapsed / translateAllProgress.current;
                  const remaining = avgPerPage * (translateAllProgress.total - translateAllProgress.current);
                  if (remaining < 60) return <span className="text-muted hidden md:inline">· ~{Math.ceil(remaining)} วิ</span>;
                  return <span className="text-muted hidden md:inline">· ~{Math.ceil(remaining / 60)} นาที</span>;
                })()}
              </div>
              <button 
                onClick={cancelTranslateAll} 
                className="bg-red-500/20 text-red-500 hover:bg-red-500/30 px-3 sm:px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-all"
              >
                Stop
              </button>
            </div>
          ) : (
            <button 
              onClick={() => handleTranslateAll()}
              disabled={isTranslating || pages.length === 0}
              className="flex-shrink-0 bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 px-3 sm:px-4 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-colors duration-150"
            >
              <Wand2 className="w-4 h-4" />
              <span className="hidden md:inline">Translate All</span>
            </button>
          )}

          <div className="flex-shrink-0 flex bg-surface hover:bg-surface-hover rounded-md border border-surface-hover transition-colors duration-150">
            <button
              onClick={() => {
                const originalName = pages[currentPage].name;
                const extension = originalName.includes('.') ? originalName.split('.').pop() : 'png';
                const baseName = originalName.includes('.') ? originalName.substring(0, originalName.lastIndexOf('.')) : originalName;
                const filename = `SuperK_Page_${String(currentPage + 1).padStart(3, '0')}_${baseName}.${extension}`;
                downloadTranslatedImage("single", currentPage, filename);
              }}
              disabled={activeBubbles.length === 0 || showOriginal}
              className="flex-shrink-0 text-foreground disabled:opacity-50 px-2 sm:px-3 py-1.5 text-sm font-medium flex items-center gap-2 border-r border-surface-hover"
              title="Download current page"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => handleDownloadAll("zip")}
              disabled={isZipping || pages.length === 0}
              className="flex-shrink-0 text-foreground disabled:opacity-50 px-2 sm:px-3 py-1.5 text-sm font-medium flex items-center gap-2 border-r border-surface-hover"
              title="Download all as ZIP"
            >
              {isZipping ? (
                <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full"></span>
              ) : (
                <span className="text-[10px] sm:text-xs font-bold">ZIP</span>
              )}
            </button>
            <button
              onClick={() => handleDownloadAll("cbz")}
              disabled={isZipping || pages.length === 0}
              className="flex-shrink-0 text-foreground disabled:opacity-50 px-2 sm:px-3 py-1.5 text-sm font-medium flex items-center gap-2 border-r border-surface-hover"
              title="Download all as CBZ (Comic format)"
            >
              {isZipping ? (
                <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full"></span>
              ) : (
                <span className="text-[10px] sm:text-xs font-bold">CBZ</span>
              )}
            </button>
            <button
              onClick={() => handleDownloadAll("pdf")}
              disabled={isZipping || pages.length === 0}
              className="flex-shrink-0 text-foreground disabled:opacity-50 px-2 sm:px-3 py-1.5 text-sm font-medium flex items-center gap-2"
              title="Download all as PDF"
            >
              {isZipping ? (
                <span className="animate-spin h-4 w-4 border-2 border-foreground border-t-transparent rounded-full"></span>
              ) : (
                <span className="text-[10px] sm:text-xs font-bold">PDF</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className={`flex-1 w-full mt-16 flex flex-col items-center transition-opacity duration-300 ${isDragging ? 'opacity-50' : 'opacity-100'} ${pages.length > 0 ? 'mb-24 sm:mb-28' : ''}`}>
        {translationResult && (
          <div className="fixed top-20 z-40 bg-surface/80 backdrop-blur-sm border border-surface-hover text-foreground px-4 py-1.5 rounded-full text-sm shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
            {translationResult}
          </div>
        )}

        {pages.length > 0 ? (
          <div className="w-full flex flex-col items-center flex-1 px-4 py-6">
            
            <div className="relative w-full flex justify-center h-full min-h-[70vh]">
              <div key={currentPage} id="pageContainer" className={`relative w-full max-w-4xl flex justify-center ${showOriginal ? 'show-original' : ''}`}>
                <img 
                  src={pages[currentPage].url} 
                  alt={pages[currentPage].name} 
                  title={pages[currentPage].name}
                  className="max-w-full h-auto object-contain drop-shadow-sm"
                />
              </div>
            </div>
            
            {isDragging && (
              <div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center">
                <div className="text-xl text-primary font-medium flex items-center gap-3">
                  <Upload className="w-6 h-6" /> Drop images to add
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center w-full max-w-2xl px-4">
            <div className={`w-full aspect-video rounded-xl border border-dashed flex flex-col items-center justify-center transition-colors duration-200 ${isDragging ? 'border-primary bg-primary/5' : 'border-surface-hover hover:border-muted'}`}>
              <Upload className={`w-8 h-8 mb-4 ${isDragging ? 'text-primary' : 'text-muted'}`} />
              <p className="text-foreground text-lg mb-1 font-medium">Drag & Drop manga pages</p>
              <p className="text-muted text-sm mb-6">Support for PNG, JPG, WebP</p>
              
              <label className="bg-surface hover:bg-surface-hover text-foreground px-6 py-2 rounded-md text-sm font-medium cursor-pointer transition-colors duration-150 border border-surface-hover">
                Browse Files
                <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
              </label>
            </div>
          </div>
        )}
      </main>

      {/* Bottom Thumbnail Strip */}
      {pages.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/90 backdrop-blur-md border-t border-surface-hover">
          <div 
            ref={thumbnailContainerRef}
            className="flex items-center h-20 sm:h-24 px-3 gap-2 overflow-x-auto scrollbar-thin"
          >
            {pages.map((page, i) => (
              <div key={i} className="relative group flex-shrink-0">
                <button
                  draggable
                  onDragStart={(e) => {
                    setDragIndex(i);
                    e.dataTransfer.effectAllowed = 'move';
                    e.stopPropagation();
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDragOverIndex(i);
                    const rect = e.currentTarget.getBoundingClientRect();
                    setDragPosition(e.clientX - rect.left > rect.width / 2 ? 'right' : 'left');
                  }}
                  onDragLeave={() => {
                    setDragOverIndex(null);
                    setDragPosition(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dragIndex !== null) {
                      const targetIndex = dragPosition === 'right' ? i + 1 : i;
                      
                      if (dragIndex !== targetIndex && dragIndex !== targetIndex - 1) {
                        setPages(prev => {
                          const updated = [...prev];
                          const [moved] = updated.splice(dragIndex, 1);
                          
                          const finalIndex = dragIndex < targetIndex ? targetIndex - 1 : targetIndex;
                          updated.splice(finalIndex, 0, moved);
                          
                          if (currentPage === dragIndex) setCurrentPage(finalIndex);
                          else if (dragIndex < currentPage && finalIndex >= currentPage) setCurrentPage(currentPage - 1);
                          else if (dragIndex > currentPage && finalIndex <= currentPage) setCurrentPage(currentPage + 1);
                          
                          return updated;
                        });
                      }
                    }
                    setDragIndex(null);
                    setDragOverIndex(null);
                    setDragPosition(null);
                  }}
                  onDragEnd={() => { setDragIndex(null); setDragOverIndex(null); setDragPosition(null); }}
                  onClick={() => { setCurrentPage(i); }}
                  className={`relative flex-shrink-0 rounded-md overflow-hidden transition-all duration-150 cursor-grab active:cursor-grabbing border-x-4 border-transparent ${
                    i === currentPage
                      ? 'ring-2 ring-primary ring-offset-2 ring-offset-background'
                      : 'opacity-60 hover:opacity-100'
                  } ${
                    dragIndex === i ? 'opacity-30 scale-90' : ''
                  } ${
                    dragOverIndex === i && dragIndex !== i 
                      ? dragPosition === 'left' ? '!border-l-primary' : '!border-r-primary' 
                      : ''
                  }`}
                  title={`${page.name} — drag to reorder`}
                >
                  <img
                    src={page.url}
                    alt={page.name}
                    className="h-12 sm:h-16 w-auto object-cover pointer-events-none"
                  />
                  <span className={`absolute bottom-0 inset-x-0 text-center text-[10px] font-medium py-0.5 ${
                    i === currentPage
                      ? 'bg-primary text-primary-content'
                      : 'bg-background/70 text-muted group-hover:text-foreground'
                  }`}>
                    {i + 1}
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setPages(prev => {
                      const newPages = prev.filter((_, idx) => idx !== i);
                      if (newPages.length === 0) setCurrentPage(0);
                      else if (currentPage >= newPages.length) setCurrentPage(newPages.length - 1);
                      else if (currentPage > i) setCurrentPage(currentPage - 1);
                      return newPages;
                    });
                  }}
                  className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-200 z-10 hover:scale-110 shadow-sm border-2 border-background"
                  title="Remove image"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                </button>
              </div>
            ))}
            
            {/* Add more pages button */}
            <label className="flex-shrink-0 flex flex-col items-center justify-center w-14 h-16 rounded-md border border-dashed border-surface-hover hover:border-muted text-muted hover:text-foreground cursor-pointer transition-colors duration-150" title="Add more pages">
              <Upload className="w-4 h-4 mb-0.5" />
              <span className="text-[10px]">Add</span>
              <input type="file" multiple accept="image/*" className="hidden" onChange={handleImageUpload} />
            </label>

            {/* Clear All button */}
            {pages.length > 1 && (
              <button 
                onClick={() => {
                  if (confirm("ลบรูปภาพทั้งหมดใช่ไหม?")) {
                    setPages([]);
                    setCurrentPage(0);
                    translatedImageCacheRef.current.clear();
                  }
                }}
                className="flex-shrink-0 flex flex-col items-center justify-center w-14 h-16 rounded-md border border-dashed border-surface-hover hover:border-red-500/50 text-muted hover:text-red-500 cursor-pointer transition-colors duration-150" 
                title="ลบรูปทั้งหมด"
              >
                <Trash2 className="w-4 h-4 mb-0.5" />
                <span className="text-[10px]">Clear All</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
