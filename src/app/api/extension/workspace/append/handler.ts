import { NextRequest, NextResponse } from "next/server";
import { requirePairingAuth } from "@/lib/server/pairing";
import type { PageTargetIdentity } from "@/lib/translation/pageEligibility";

export interface WorkspaceHandoffPayload {
  pageUrl: string;
  name?: string;
  cleanUrl?: string;
  bubbles?: unknown[];
  originUrl?: string;
  /** Original bytes and policy evidence used by the editor to verify a safe handoff. */
  sourceImage?: string;
  sourceRevision?: string;
  targetIdentity?: PageTargetIdentity;
}

interface StoredHandoff extends WorkspaceHandoffPayload {
  handoffId: string;
  createdAt: number;
}

const handoffs = new Map<string, StoredHandoff>();

// Handoffs are one-shot editor invitations: they expire after a day so long
// desktop sessions do not accumulate them forever.
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000;
let handoffTtlMs = HANDOFF_TTL_MS;

export function _resetHandoffsForTest() {
  handoffs.clear();
  handoffTtlMs = HANDOFF_TTL_MS;
}

export function _setHandoffTtlForTest(ms: number) {
  handoffTtlMs = ms;
}

function sweepExpiredHandoffs() {
  const now = Date.now();
  for (const [id, handoff] of handoffs) {
    if (now - handoff.createdAt >= handoffTtlMs) {
      handoffs.delete(id);
    }
  }
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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-superk-pairing-token",
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

  const unauthorized = requirePairingAuth(request, buildCorsHeaders(origin));
  if (unauthorized) return unauthorized;

  sweepExpiredHandoffs();

  try {
    const body = (await request.json()) as WorkspaceHandoffPayload;
    if (!body || typeof body !== "object" || typeof body.pageUrl !== "string") {
      return NextResponse.json({ error: "Invalid payload: pageUrl required" }, { status: 400 });
    }
    if (body.sourceImage !== undefined && (typeof body.sourceImage !== "string" || body.sourceImage.length > 28 * 1024 * 1024)) {
      return NextResponse.json({ error: "Invalid original source image" }, { status: 400 });
    }
    if (body.sourceRevision !== undefined && (typeof body.sourceRevision !== "string" || !/^[a-f0-9]{64}$/.test(body.sourceRevision))) {
      return NextResponse.json({ error: "Invalid original source revision" }, { status: 400 });
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

  const unauthorized = requirePairingAuth(request, buildCorsHeaders(origin));
  if (unauthorized) return unauthorized;

  sweepExpiredHandoffs();

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
