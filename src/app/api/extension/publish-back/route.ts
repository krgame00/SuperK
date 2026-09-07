import { NextRequest, NextResponse } from "next/server";

export interface PublishBackPayload {
  pageUrl: string;
  originUrl?: string;
  bubbles: any[];
  textStyle?: any;
  cleanUrl?: string;
}

interface StoredPublication extends PublishBackPayload {
  updatedAt: number;
}

const publishedMap = new Map<string, StoredPublication>();

export function _resetPublishedForTest() {
  publishedMap.clear();
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
    const body = (await request.json()) as PublishBackPayload;
    if (!body || typeof body !== "object" || typeof body.pageUrl !== "string" || !body.pageUrl.trim()) {
      return NextResponse.json({ error: "Invalid payload: pageUrl required" }, { status: 400 });
    }

    const updatedAt = Date.now();
    const publication: StoredPublication = {
      ...body,
      updatedAt,
    };
    publishedMap.set(body.pageUrl, publication);

    return NextResponse.json(
      {
        success: true,
        publishedAt: updatedAt,
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
  const pageUrl = url.searchParams.get("pageUrl");
  const sinceParam = url.searchParams.get("since");

  if (pageUrl) {
    const record = publishedMap.get(pageUrl);
    if (!record) {
      return NextResponse.json({ error: "Published update not found" }, { status: 404 });
    }
    return NextResponse.json(record, { headers: buildCorsHeaders(origin) });
  }

  const since = sinceParam ? parseInt(sinceParam, 10) : 0;
  const updates = Array.from(publishedMap.values()).filter(
    (record) => !since || record.updatedAt >= since
  );

  return NextResponse.json(
    { updates },
    { headers: buildCorsHeaders(origin) }
  );
}
