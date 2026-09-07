import { NextRequest, NextResponse } from "next/server";

export interface WorkspaceHandoffPayload {
  pageUrl: string;
  name?: string;
  cleanUrl?: string;
  bubbles?: any[];
  originUrl?: string;
}

interface StoredHandoff extends WorkspaceHandoffPayload {
  handoffId: string;
  createdAt: number;
}

const handoffs = new Map<string, StoredHandoff>();

export function _resetHandoffsForTest() {
  handoffs.clear();
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

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as WorkspaceHandoffPayload;
    if (!body || typeof body !== "object" || typeof body.pageUrl !== "string") {
      return NextResponse.json({ error: "Invalid payload: pageUrl required" }, { status: 400 });
    }

    const handoffId = `hnd_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    const stored: StoredHandoff = {
      ...body,
      handoffId,
      createdAt: Date.now(),
    };
    handoffs.set(handoffId, stored);

    // Build editUrl pointing to local SuperK frontend
    let originBase = "http://127.0.0.1:3000";
    try {
      const host = request.headers.get("host") || "127.0.0.1:3000";
      originBase = `http://${host}`;
    } catch {
      // fallback
    }

    const editUrl = `${originBase}/?handoff=${handoffId}`;

    return NextResponse.json(
      {
        success: true,
        handoffId,
        editUrl,
      },
      { headers: buildCorsHeaders(origin) }
    );
  } catch {
    return NextResponse.json({ error: "Failed to parse body" }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: "Forbidden origin" }, { status: 403 });
  }

  const url = new URL(request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Handoff ID required" }, { status: 400 });
  }

  const handoff = handoffs.get(id);
  if (!handoff) {
    return NextResponse.json({ error: "Handoff not found or expired" }, { status: 404 });
  }

  return NextResponse.json(handoff, {
    headers: buildCorsHeaders(origin),
  });
}
