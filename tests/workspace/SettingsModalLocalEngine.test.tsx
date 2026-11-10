import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SettingsModal } from "@/components/workspace/SettingsModal";
import type { ModelPreference } from "@/lib/translation/modelPreference";

const baseTextStyle = {
  fontFamily: "Itim, sans-serif",
  fontSizeMultiplier: 1,
  textColor: "#000000",
  textOutline: "#ffffff",
};

function baseProps(modelPreference: ModelPreference) {
  return {
    isOpen: true,
    onClose: vi.fn(),
    sourceLang: "auto",
    onSourceLangChange: vi.fn(),
    textStyle: baseTextStyle,
    onTextStyleChange: vi.fn(),
    modelPreference,
    onModelPreferenceChange: vi.fn(),
    userApiKey: "",
    onUserApiKeyChange: vi.fn(),
  };
}

function okProbeResponse() {
  return Response.json({
    ok: true,
    baseUrl: "http://localhost:11434/v1",
    models: [{ id: "qwen2.5-vl:7b" }, { id: "gemma3:12b" }],
    latencyMs: 1,
  });
}

/** Route-aware stub: only the discovery route gets a probe body; other
 *  callers (catalog loader, pairing) get a handled non-2xx. */
function stubbedFetch(probeResponse: () => Response) {
  return vi.fn().mockImplementation((url: string) =>
    url === "/api/translate/local-models"
      ? Promise.resolve(probeResponse())
      : Promise.resolve(new Response(null, { status: 404 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsModal Local engine card", () => {
  it("commits the normalized default base URL and probes through the discovery route when Local is selected", async () => {
    const fetchMock = stubbedFetch(okProbeResponse);
    vi.stubGlobal("fetch", fetchMock);
    const props = baseProps({ engine: "auto" });
    render(<SettingsModal {...props} />);

    fireEvent.click(screen.getByRole("button", { name: /Model Preference/i }));
    fireEvent.click(screen.getByRole("option", { name: /Local/i }));

    expect(props.onModelPreferenceChange).toHaveBeenCalledWith({
      engine: "local",
      baseUrl: "http://localhost:11434/v1",
      model: "",
    });
    await waitFor(() => {
      const probeCall = fetchMock.mock.calls.find(([url]) => url === "/api/translate/local-models");
      expect(probeCall).toBeDefined();
    });
    const probeCall = fetchMock.mock.calls.find(([url]) => url === "/api/translate/local-models");
    const probeBody = JSON.parse(String(probeCall?.[1]?.body));
    expect(probeBody).toEqual({ baseUrl: "http://localhost:11434/v1" });
  });

  it("normalizes a committed base URL, probes it, and commits a model once the probe connects", async () => {
    vi.stubGlobal("fetch", stubbedFetch(okProbeResponse));
    const props = baseProps({ engine: "local", baseUrl: "http://localhost:11434/v1", model: "" });
    render(<SettingsModal {...props} />);

    const baseUrlInput = screen.getByLabelText("Local Engine (Ollama / llama.cpp)");
    fireEvent.change(baseUrlInput, { target: { value: "http://192.168.1.20:8080/llama" } });
    fireEvent.blur(baseUrlInput);

    expect(props.onModelPreferenceChange).toHaveBeenCalledWith({
      engine: "local",
      baseUrl: "http://192.168.1.20:8080/llama/v1",
      model: "",
    });

    const modelSelect = await waitFor(() => {
      const select = screen.getByLabelText(/โมเดลของ Local Engine/i) as HTMLSelectElement;
      expect(select).toBeEnabled();
      return select;
    });
    fireEvent.change(modelSelect, { target: { value: "qwen2.5-vl:7b" } });

    expect(props.onModelPreferenceChange).toHaveBeenLastCalledWith({
      engine: "local",
      baseUrl: "http://localhost:11434/v1",
      model: "qwen2.5-vl:7b",
    });
  });

  it("shows the probe failure message instead of a model list when the daemon is unreachable", async () => {
    vi.stubGlobal("fetch", stubbedFetch(() => Response.json({
      ok: false,
      baseUrl: "http://localhost:11434/v1",
      code: "LOCAL_UNREACHABLE",
      error: "Could not reach the local engine at http://localhost:11434/v1. Is the daemon running?",
    })));
    const props = baseProps({ engine: "local", baseUrl: "http://localhost:11434/v1", model: "" });
    render(<SettingsModal {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "รีเฟรชสถานะ Local Engine" }));

    await waitFor(() =>
      expect(screen.getByText(/Could not reach the local engine/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/โมเดลของ Local Engine/i)).toBeDisabled();
  });
});
