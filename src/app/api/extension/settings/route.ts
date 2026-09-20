import { NextRequest, NextResponse } from "next/server";
import { geminiCatalogManager } from "@/lib/server/geminiCatalog";
import { verifyPairingToken } from "@/lib/server/pairing";

export interface ExtensionSettingsPayload {
  geminiApiKey: string;
  modelPreference: string;
  modelHierarchy: string[];
  allowPreviewModels: boolean;
  modelCatalog?: {
    source: string;
    stale: boolean;
    models: Array<{
      id: string;
      displayName: string;
      releaseChannel: "stable" | "preview" | "experimental";
      availabilityCount: number;
      totalKeys: number;
    }>;
  };
  glossary: Array<{ original: string; translation: string }>;
  textStyle: {
    fontFamily: string;
    fontSizeMultiplier: number;
    textColor: string;
    textOutline: string;
  };
  ocrServiceUrl: string;
  targetLang: string;
  sourceLang: string;
  cleanMode: "inpainting" | "stroke" | "solid";
}

const defaultSettings: ExtensionSettingsPayload = {
  geminiApiKey: "", // Never use server key as default!
  modelPreference: "auto",
  // Compatibility field for older extension builds. The dynamic catalog/router is authoritative.
  modelHierarchy: [],
  allowPreviewModels: false,
  glossary: [],
  textStyle: {
    fontFamily: "Itim, sans-serif",
    fontSizeMultiplier: 1.0,
    textColor: "#000000",
    textOutline: "#FFFFFF",
  },
  ocrServiceUrl: process.env.OCR_SERVICE_URL || "http://127.0.0.1:8765",
  targetLang: "Thai",
  sourceLang: "auto",
  cleanMode: "inpainting",
};

let currentSettings: ExtensionSettingsPayload = { ...defaultSettings };

export function _resetSettingsForTest() {
  currentSettings = {
    ...defaultSettings,
    geminiApiKey: "",
  };
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true;
  if (origin.startsWith("chrome-extension://") || origin.startsWith("moz-extension://")) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    const hostname = parsed.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function buildCorsHeaders(origin: string | null): Record<string, string> {
  const allowed = isOriginAllowed(origin);
  return {
    "Access-Control-Allow-Origin": allowed && origin ? origin : "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return new NextResponse(JSON.stringify({ error: "Forbidden origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(origin),
  });
}

function extractPairingToken(request: NextRequest): string | null {
  const auth = request.headers.get("authorization");
  if (auth && auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }
  const headerToken = request.headers.get("x-superk-pairing-token");
  if (headerToken) return headerToken.trim();
  const url = new URL(request.url);
  const queryToken = url.searchParams.get("token") || url.searchParams.get("pairingToken");
  if (queryToken) return queryToken.trim();
  return null;
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const pairingToken = extractPairingToken(request);
  if (!verifyPairingToken(pairingToken)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing pairing token" },
      { status: 401, headers: buildCorsHeaders(origin) }
    );
  }

  const userApiKey = currentSettings.geminiApiKey || "";
  const activeApiKeyForCatalog = userApiKey || process.env.GEMINI_API_KEY || "";
  let modelCatalog: ExtensionSettingsPayload["modelCatalog"];
  if (activeApiKeyForCatalog) {
    try {
      const { snapshot } = await geminiCatalogManager.getCatalog({
        userApiKeyRaw: userApiKey || undefined,
        serverApiKeyRaw: process.env.GEMINI_API_KEY || undefined,
      });
      modelCatalog = {
        source: snapshot.source,
        stale: snapshot.stale,
        models: snapshot.models.map((model) => ({
          id: model.id,
          displayName: model.displayName,
          releaseChannel: model.releaseChannel,
          availabilityCount: model.availabilityCount,
          totalKeys: model.totalKeys,
        })),
      };
    } catch {
      modelCatalog = currentSettings.modelCatalog;
    }
  }

  const responsePayload = {
    ...currentSettings,
    // Never expose secret keys to callers!
    geminiApiKey: "",
    hasServerKey: Boolean(process.env.GEMINI_API_KEY),
    modelCatalog,
  };

  return NextResponse.json(responsePayload, {
    headers: buildCorsHeaders(origin),
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const pairingToken = extractPairingToken(request);
  if (!verifyPairingToken(pairingToken)) {
    return NextResponse.json(
      { error: "Unauthorized: Invalid or missing pairing token" },
      { status: 401, headers: buildCorsHeaders(origin) }
    );
  }

  try {
    const body = await request.json();
    if (typeof body !== "object" || body === null) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    if (typeof body.geminiApiKey === "string") {
      currentSettings.geminiApiKey = body.geminiApiKey;
    }
    if (typeof body.modelPreference === "string") {
      currentSettings.modelPreference = body.modelPreference;
    }
    if (typeof body.allowPreviewModels === "boolean") {
      currentSettings.allowPreviewModels = body.allowPreviewModels;
    }
    if (Array.isArray(body.glossary)) {
      currentSettings.glossary = body.glossary;
    }
    if (body.textStyle && typeof body.textStyle === "object") {
      currentSettings.textStyle = {
        ...currentSettings.textStyle,
        ...body.textStyle,
      };
    }
    if (typeof body.ocrServiceUrl === "string") {
      currentSettings.ocrServiceUrl = body.ocrServiceUrl;
    }
    if (typeof body.targetLang === "string") {
      currentSettings.targetLang = body.targetLang;
    }
    if (typeof body.sourceLang === "string") {
      currentSettings.sourceLang = body.sourceLang;
    }
    if (["inpainting", "stroke", "solid"].includes(body.cleanMode)) {
      currentSettings.cleanMode = body.cleanMode;
    }

    const safeSettings = {
      ...currentSettings,
      geminiApiKey: "", // Never echo secret keys back!
      hasServerKey: Boolean(process.env.GEMINI_API_KEY),
    };

    return NextResponse.json(
      { success: true, settings: safeSettings },
      { headers: buildCorsHeaders(origin) }
    );
  } catch {
    return NextResponse.json({ error: "Failed to parse body" }, { status: 400 });
  }
}
