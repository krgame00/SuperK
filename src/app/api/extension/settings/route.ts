import { NextRequest, NextResponse } from "next/server";

export interface ExtensionSettingsPayload {
  geminiApiKey: string;
  modelPreference: string;
  modelHierarchy: string[];
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

const DEFAULT_MODEL_HIERARCHY = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];

const defaultSettings: ExtensionSettingsPayload = {
  geminiApiKey: process.env.GEMINI_API_KEY || "",
  modelPreference: "auto",
  modelHierarchy: DEFAULT_MODEL_HIERARCHY,
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
    geminiApiKey: process.env.GEMINI_API_KEY || "",
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

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const responsePayload = {
    ...currentSettings,
    geminiApiKey: currentSettings.geminiApiKey || process.env.GEMINI_API_KEY || "",
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

    return NextResponse.json(
      { success: true, settings: currentSettings },
      { headers: buildCorsHeaders(origin) }
    );
  } catch {
    return NextResponse.json({ error: "Failed to parse body" }, { status: 400 });
  }
}
