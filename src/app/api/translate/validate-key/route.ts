import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  requestGemini,
} from "@/lib/server/geminiRequest";

interface ValidationRequestBody {
  apiKey?: string;
}

export async function POST(req: Request) {
  let body: ValidationRequestBody;
  try {
    body = (await req.json()) as ValidationRequestBody;
  } catch {
    return NextResponse.json(
      { valid: false, message: "รูปแบบคำขอไม่ถูกต้อง" },
      { status: 400 },
    );
  }

  const apiKey = body.apiKey?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { valid: false, message: "กรุณากรอก Gemini API Key" },
      { status: 400 },
    );
  }

  try {
    await requestGemini({
      apiKeys: [apiKey],
      models: ["gemini-2.5-flash-lite"],
      payload: {
        contents: [{ parts: [{ text: "Reply only with OK." }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 },
      },
      attemptTimeoutMs: 10_000,
      totalBudgetMs: 12_000,
    });

    return NextResponse.json({
      valid: true,
      message: "API Key พร้อมใช้งาน",
    });
  } catch (error) {
    if (error instanceof GeminiRequestError && error.status === 429) {
      return NextResponse.json({
        valid: true,
        message: "API Key ถูกต้อง แต่โควต้ากำลังอยู่ในช่วงคูลดาวน์",
      });
    }

    const message =
      error instanceof GeminiRequestError && (error.status === 400 || error.status === 401 || error.status === 403)
        ? "API Key ใช้งานไม่ได้หรือไม่มีสิทธิ์เรียก Gemini API"
        : "ไม่สามารถตรวจสอบ API Key ได้ในขณะนี้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองอีกครั้ง";

    return NextResponse.json(
      { valid: false, message },
      { status: error instanceof GeminiRequestError ? error.status : 502 },
    );
  }
}
