import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import path from "path";
import fs from "fs";

function isLocalLoopback(req: NextRequest): boolean {
  const host = req.headers.get("host") || "";
  const origin = req.headers.get("origin") || "";

  const isLoopbackHost =
    host.startsWith("127.0.0.1") ||
    host.startsWith("localhost") ||
    host.startsWith("[::1]");

  if (!isLoopbackHost) return false;

  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      const originHost = parsedOrigin.hostname;
      if (
        originHost !== "127.0.0.1" &&
        originHost !== "localhost" &&
        originHost !== "::1"
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export async function GET(req: NextRequest) {
  if (!isLocalLoopback(req)) {
    return NextResponse.json({ error: "Forbidden: Local access only" }, { status: 403 });
  }

  return NextResponse.json({
    status: "ok",
    pid: process.pid,
    platform: process.platform,
    timestamp: Date.now(),
  });
}

export async function POST(req: NextRequest) {
  if (!isLocalLoopback(req)) {
    return NextResponse.json({ error: "Forbidden: Local access only" }, { status: 403 });
  }

  // If not in testing environment, initiate graceful teardown after sending response
  if (process.env.NODE_ENV !== "test") {
    setTimeout(() => {
      try {
        const rootDir = process.cwd();
        const stopBat = path.join(rootDir, "stop.bat");

        if (fs.existsSync(stopBat)) {
          exec(`cmd.exe /c "${stopBat}"`, () => {
            process.exit(0);
          });
        } else {
          process.exit(0);
        }
      } catch {
        process.exit(0);
      }
    }, 500);
  }

  return NextResponse.json({
    success: true,
    message: "กำลังปิดระบบ SuperK ทั้งหมดและคืนทรัพยากร RAM/CPU เรียบร้อยแล้ว",
  });
}
