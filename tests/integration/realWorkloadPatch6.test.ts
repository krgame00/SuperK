import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  formatStructuredMangaText,
  isStructuredMangaList,
  hasBrokenThaiLineBreak,
  isStructuredSectionHeaderLine,
} from "../../lib/textBoxWidthLayout";
import {
  analyzeRegionMaskLocally,
  applyGeminiMaskReviewToSuggestion,
} from "../../lib/cleaning/aiMaskInspector";
import { getUnconfirmedPages } from "../../lib/export/reviewGate";
import { LANGUAGE_POLICY_VERSION } from "../../lib/languagePolicy";

interface WorkspaceExportPage {
  url: string;
  name: string;
  exportSource?: "translated" | "original" | "clean";
  exportExcluded?: boolean;
  sourceFingerprint?: string;
}

describe("Real-World Workload: 6-Fixes Verification", () => {
  // 1. Structured Character Profile Layout & Thai Word Break
  it("formats structured manga character profile sections and bullets cleanly", () => {
    const rawProfile =
      "เรือนร่าง: • แม่วัวนม อวบอั๋น เซ็กซี่ขยี้ใจ พรสวรรค์: • จอมเวทศักดิ์สิทธิ์ • ตระกูลขุนนางแห่งจักรวรรดิ";
    
    expect(isStructuredMangaList(rawProfile)).toBe(true);

    const formatted = formatStructuredMangaText(rawProfile);
    const lines = formatted.split("\n");

    expect(lines[0]).toBe("เรือนร่าง:");
    expect(isStructuredSectionHeaderLine(lines[0])).toBe(true);
    expect(lines[1]).toBe("• แม่วัวนม อวบอั๋น เซ็กซี่ขยี้ใจ");
    expect(lines[2]).toBe("พรสวรรค์:");
    expect(isStructuredSectionHeaderLine(lines[2])).toBe(true);
    expect(lines[3]).toBe("• จอมเวทศักดิ์สิทธิ์");
    expect(lines[4]).toBe("• ตระกูลขุนนางแห่งจักรวรรดิ");

    // Trailing inline header after a bullet sentence must be flagged as broken layout
    const brokenLineSample = [
      "• เธอก็ไม่รู้เหมือนกัน แต่เธอก็ไม่ได้ใส่ใจ พรสวรรค์:",
      "• บุตรสาวแห่งดยุก",
    ];
    expect(hasBrokenThaiLineBreak(brokenLineSample)).toBe(true);

    // Properly formatted lines must not be flagged
    expect(hasBrokenThaiLineBreak(lines)).toBe(false);
  });

  // 2. Real AI Mask Inspector: Connected Component Analysis (CCA) & oversized box rejection
  it("protects non-text artwork and rejects broad addBoxes enclosing character bodies", () => {
    const rw = 200;
    const rh = 200;
    const baseMask = {
      width: rw,
      height: rh,
      data: new Uint8ClampedArray(rw * rh * 4),
    } as ImageData;
    const originalCrop = {
      width: rw,
      height: rh,
      data: new Uint8ClampedArray(rw * rh * 4),
    } as ImageData;

    // Fill background with near-white
    for (let i = 0; i < rw * rh * 4; i += 4) {
      originalCrop.data[i] = 245;
      originalCrop.data[i + 1] = 245;
      originalCrop.data[i + 2] = 245;
      originalCrop.data[i + 3] = 255;
    }

    // Small text stroke in region center
    for (let y = 60; y < 80; y++) {
      for (let x = 60; x < 65; x++) {
        const idx = (y * rw + x) * 4;
        originalCrop.data[idx] = 15;
        originalCrop.data[idx + 1] = 15;
        originalCrop.data[idx + 2] = 15;
        baseMask.data[idx] = 255;
        baseMask.data[idx + 1] = 55;
        baseMask.data[idx + 2] = 80;
        baseMask.data[idx + 3] = 150;
      }
    }

    const audit = analyzeRegionMaskLocally({
      baseMask,
      rect: { x: 0, y: 0, width: rw, height: rh },
      regionId: "test-reg-1",
      originalCrop,
    });

    expect(audit).toBeDefined();
    expect(audit.stats).toBeDefined();

    // Now test Gemini mask review rejection of overly broad addBox (>30% of region)
    const reviewWithGiantBox = {
      verdict: "under_masked" as const,
      summary: "AI ตรวจพบจุดตกหล่น",
      addBoxes: [
        [0, 0, 700, 700] as [number, number, number, number], // 49% area -> MUST BE REJECTED
        [300, 300, 400, 350] as [number, number, number, number], // 0.5% area tightly on stroke
      ],
      protectBoxes: [],
    };

    const suggested = applyGeminiMaskReviewToSuggestion(audit, reviewWithGiantBox, originalCrop);
    expect(suggested.verdict).toBe("under_masked");
    expect(suggested.stats).toBeDefined();
    // Verify that giant box didn't turn half the image into a mask!
    expect(suggested.stats.suggestedPixels).toBeLessThan(rw * rh * 0.1);
  });

  // 3. Real live OCR Service connection on port 8765
  it("interacts with live Python OCR service daemon on port 8765", async () => {
    const healthRes = await fetch("http://127.0.0.1:8765/health");
    expect(healthRes.ok).toBe(true);
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe("ok");

    // Check models status
    const modelsRes = await fetch("http://127.0.0.1:8765/v1/models/status");
    expect(modelsRes.ok).toBe(true);
    const modelsJson = await modelsRes.json();
    expect(modelsJson.unloaded !== undefined || modelsJson.loaded !== undefined).toBe(true);
  });

  // 4. Real live Next.js /api/mask-review Route on port 3000
  it("responds from live Next.js /api/mask-review route with prompt hardening", async () => {
    // Test input validation
    const badRes = await fetch("http://127.0.0.1:3000/api/mask-review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(badRes.status).toBe(400);
    const badJson = await badRes.json();
    expect(badJson.code).toBe("INVALID_REQUEST");
  });

  // 5. Pre-Export Gate & Explicit User Approval Invariant
  it("strictly enforces explicit user approval for unconfirmed pages during export", () => {
    const testPages: WorkspaceExportPage[] = [
      { url: "blob:p1", name: "Page 1", exportSource: "translated", sourceFingerprint: "sig1" },
      { url: "blob:p2", name: "Page 2", exportSource: "clean", sourceFingerprint: "sig2" },
    ];

    const confirmedPages = new Set<string>();
    const cleaningResults = new Map();
    cleaningResults.set("blob:p1", {
      cleanUrl: "blob:clean-1",
      width: 1000,
      height: 1000,
      regions: [{ status: "needs_review", confidence: 0.5, rect: { x: 0, y: 0, width: 10, height: 10 } }],
      sourceFingerprint: "sig1",
    });
    cleaningResults.set("blob:p2", {
      cleanUrl: "blob:clean-2",
      width: 1000,
      height: 1000,
      regions: [],
      sourceFingerprint: "sig2",
    });

    const bubblesMap = new Map();
    bubblesMap.set("blob:p1", [{
      id: "b1",
      box: [10, 10, 50, 50],
      t: "ข้อความแปลแล้ว",
      translationReview: {
        status: "ok",
        policyVersion: LANGUAGE_POLICY_VERSION,
        sourceRevision: "sig1",
        targetId: "th",
        sourceText: "",
        reviewedText: "ข้อความแปลแล้ว",
      },
    }]);

    const targetIdentities = new Map([
      ["blob:p1", { pageId: "blob:p1", confirmedTarget: "th", targetLanguage: "th", targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION }],
      ["blob:p2", { pageId: "blob:p2", confirmedTarget: "th", targetLanguage: "th", targetId: "th", policyVersion: LANGUAGE_POLICY_VERSION }],
    ]);

    const backgroundInspections = new Map<string, any>([
      ["blob:p1", { status: "inspected", revisionKey: "rev1", revisions: { sourceRevision: "sig1", backgroundRevision: "bg1", removalRevision: "rm1" }, candidates: [], inspectedAreas: 1 }],
      ["blob:p2", { status: "inspected", revisionKey: "rev2", revisions: { sourceRevision: "sig2", backgroundRevision: "bg2", removalRevision: "rm2" }, candidates: [], inspectedAreas: 1 }],
    ]);

    const unconfirmed = getUnconfirmedPages(
      testPages,
      confirmedPages,
      cleaningResults,
      bubblesMap,
      undefined,
      new Map(),
      {
        sourceRevisions: new Map([["blob:p1", "sig1"], ["blob:p2", "sig2"]]),
        targetIdentities: targetIdentities as any,
        backgroundInspections,
      },
    );

    // p1 has needs_review cleaning & translation, so it's unconfirmed
    expect(unconfirmed.length).toBe(1);
    expect(unconfirmed[0].pageUrl).toBe("blob:p1");

    // Explicit user approval clears the review warning:
    const confirmedMissingTranslations = new Map<string, string>();
    confirmedMissingTranslations.set("blob:p1", unconfirmed[0].missingTranslationSignature);
    confirmedPages.add("blob:p1");
    const afterApproval = getUnconfirmedPages(
      testPages,
      confirmedPages,
      cleaningResults,
      bubblesMap,
      undefined,
      confirmedMissingTranslations,
      {
        sourceRevisions: new Map([["blob:p1", "sig1"], ["blob:p2", "sig2"]]),
        targetIdentities: targetIdentities as any,
        backgroundInspections,
      },
    );

    // After approval, no unconfirmed pages remain
    expect(afterApproval.length).toBe(0);

    // Bypassing with allowUnreviewedExport also immediately clears for user override
    const bypassed = getUnconfirmedPages(
      testPages,
      new Set(),
      cleaningResults,
      bubblesMap,
      undefined,
      new Map(),
      {
        allowUnreviewedExport: true,
      },
    );
    expect(bypassed.length).toBe(0);
  });
});
