import net from "net";
import { describe, expect, it } from "vitest";
import { getPlatformPipePath, VNPipeServer } from "@/lib/vn/pipeServer";
import { type TextFrame } from "@/lib/vn/types";

describe("Visual Novel IPC Pipe Server (Blueprint Module 4)", () => {
  it("generates correct platform IPC pipe path", () => {
    const pipePath = getPlatformPipePath("test_pipe");
    if (process.platform === "win32") {
      expect(pipePath).toBe("\\\\.\\pipe\\test_pipe");
    } else {
      expect(pipePath).toContain("test_pipe.sock");
    }
  });

  it("receives and debounces structured TextFrame stream over IPC socket", async () => {
    const receivedFrames: TextFrame[] = [];
    const pipeName = `superk_test_pipe_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const server = new VNPipeServer({
      pipeName,
      stabilityThresholdMs: 60,
      onDialogueReady: (frame) => {
        receivedFrames.push(frame);
      },
    });

    const activePipePath = await server.start();
    expect(activePipePath).toBeTruthy();

    // Connect client socket mimicking Injected Hook DLL
    const client = net.createConnection(activePipePath);
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));

    // Stream typewriter frames: "ฮ" -> "ฮา" -> "ฮาโหล"
    client.write(
      JSON.stringify({
        rawText: "ฮ",
        engineType: "renpy",
        processId: 1234,
      }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 20));

    client.write(
      JSON.stringify({
        rawText: "ฮา",
        engineType: "renpy",
        processId: 1234,
      }) + "\n",
    );

    await new Promise((r) => setTimeout(r, 20));

    client.write(
      JSON.stringify({
        rawText: "【桜】ฮาโหลชาวโลก",
        engineType: "renpy",
        processId: 1234,
      }) + "\n",
    );

    // Wait for stability threshold (60ms) to trigger emit
    await new Promise((r) => setTimeout(r, 120));

    expect(receivedFrames.length).toBeGreaterThanOrEqual(1);
    const lastFrame = receivedFrames[receivedFrames.length - 1];
    expect(lastFrame.rawText).toBe("ฮาโหลชาวโลก");
    expect(lastFrame.speakerName).toBe("桜");
    expect(lastFrame.engineType).toBe("renpy");
    expect(lastFrame.processId).toBe(1234);

    client.destroy();
    await server.stop();
  });

  it("handles plain string newline-delimited stream fallback", async () => {
    const receivedFrames: TextFrame[] = [];
    const pipeName = `superk_test_plain_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const server = new VNPipeServer({
      pipeName,
      stabilityThresholdMs: 50,
      onDialogueReady: (frame) => {
        receivedFrames.push(frame);
      },
    });

    const activePipePath = await server.start();

    const client = net.createConnection(activePipePath);
    await new Promise<void>((resolve) => client.once("connect", () => resolve()));

    // Send direct plain text line
    client.write("สวัสดีจากเกม Kirikiri\n");

    await new Promise((r) => setTimeout(r, 100));

    expect(receivedFrames.length).toBeGreaterThanOrEqual(1);
    expect(receivedFrames[0].rawText).toBe("สวัสดีจากเกม Kirikiri");

    client.destroy();
    await server.stop();
  });
});
