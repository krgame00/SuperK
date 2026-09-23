import { NextResponse } from "next/server";

import {
  GeminiRoutingError,
  geminiCatalogManager,
  getGeminiKeyLimit,
} from "@/lib/server/geminiCatalog";
import { geminiRoutingHttpStatus } from "@/lib/server/geminiTranslationRouter";

interface ModelCatalogRequestBody {
  apiKey?: string;
  force?: boolean;
}

export async function POST(req: Request) {
  let body: ModelCatalogRequestBody;
  try {
    body = (await req.json()) as ModelCatalogRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid model catalog request" },
      { status: 400 },
    );
  }

  try {
    const catalog = await geminiCatalogManager.getCatalog({
      userApiKeyRaw: body.apiKey,
      serverApiKeyRaw: process.env.GEMINI_API_KEY,
      force: body.force === true,
    });

    const snapshot = catalog.snapshot;
    const models = snapshot.models.map((model) => ({
      id: model.id,
      displayName: model.displayName,
      description: model.description,
      releaseChannel: model.releaseChannel,
      availabilityCount: model.availabilityCount,
      totalKeys: model.totalKeys,
      compatibility: model.compatibility,
      ...geminiCatalogManager.getModelHealth(catalog, model.id),
    }));

    return NextResponse.json({
      owner: snapshot.owner,
      source: snapshot.source,
      stale: snapshot.stale,
      discoveredAt: snapshot.discoveredAt,
      expiresAt: snapshot.expiresAt,
      totalKeys: catalog.pool.keys.length,
      maxKeys: getGeminiKeyLimit(),
      validKeys: snapshot.keys.filter((key) => key.valid).length,
      keys: snapshot.keys.map((key) => ({
        slot: key.slot,
        owner: key.owner,
        valid: key.valid,
        modelCount: key.modelCount,
        errorCode: key.errorCode,
      })),
      models,
    });
  } catch (error) {
    if (error instanceof GeminiRoutingError) {
      return NextResponse.json(
        {
          error: error.message,
          code: error.code,
          model: error.model,
        },
        { status: geminiRoutingHttpStatus(error) },
      );
    }
    return NextResponse.json(
      { error: "Unable to load Gemini model catalog" },
      { status: 502 },
    );
  }
}
