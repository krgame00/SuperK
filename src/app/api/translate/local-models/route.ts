import { NextResponse } from "next/server";

import { requireLocalRequest } from "@/lib/server/localRequest";
import { probeLocalEngine } from "@/lib/server/localEngine";
import { normalizeLocalBaseUrl } from "@/lib/translation/modelPreference";

interface LocalModelsRequestBody {
  baseUrl?: string;
}

export async function POST(req: Request) {
  const denial = requireLocalRequest(req);
  if (denial) return denial;
  let body: LocalModelsRequestBody | null = null;
  try {
    body = (await req.json()) as LocalModelsRequestBody;
  } catch {
    body = null;
  }
  const raw = typeof body?.baseUrl === "string" ? body.baseUrl : "";
  if (!normalizeLocalBaseUrl(raw)) {
    return NextResponse.json(
      { error: "Missing or invalid local base URL", code: "INVALID_BASE_URL" },
      { status: 400 },
    );
  }
  // "Daemon not found" is a successful status check with a negative result,
  // so both probe outcomes answer 200 and the UI reads ok/code.
  const result = await probeLocalEngine({ baseUrl: raw });
  return NextResponse.json(result);
}
