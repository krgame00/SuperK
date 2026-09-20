import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";

const defaultProps: SettingsModalProps = {
  isOpen: true,
  onClose: vi.fn(),
  sourceLang: "auto",
  onSourceLangChange: vi.fn(),
  textStyle: {
    fontFamily: "Itim, sans-serif",
    fontSizeMultiplier: 1,
    textColor: "#000000",
    textOutline: "#ffffff",
  },
  onTextStyleChange: vi.fn(),
  modelPreference: "auto",
  onModelPreferenceChange: vi.fn(),
  userApiKey: "",
  onUserApiKeyChange: vi.fn(),
  allowPreviewModels: false,
  onAllowPreviewModelsChange: vi.fn(),
};

const catalog = {
  owner: "user",
  source: "live",
  stale: false,
  discoveredAt: 1,
  expiresAt: 2,
  totalKeys: 2,
  keys: [
    { slot: 1, valid: true, modelCount: 2 },
    { slot: 2, valid: true, modelCount: 1 },
  ],
  models: [
    {
      id: "gemini-dynamic-stable",
      displayName: "Gemini Dynamic Stable",
      description: "stable",
      releaseChannel: "stable",
      availabilityCount: 2,
      totalKeys: 2,
      cooldownKeys: 0,
      compatibility: { text: "compatible", image: "compatible" },
    },
    {
      id: "gemini-dynamic-preview",
      displayName: "Gemini Dynamic Preview",
      releaseChannel: "preview",
      availabilityCount: 1,
      totalKeys: 2,
      cooldownKeys: 1,
      compatibility: { text: "unverified", image: "unverified" },
    },
  ],
};

describe("SettingsModal dynamic Gemini catalog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof Request ? input.url : input.toString();
        if (url.includes("/api/extension/pair")) {
          return Promise.resolve(Response.json({ success: true, pairingToken: "test-token" }));
        }
        return Promise.resolve(Response.json(catalog));
      }),
    );
  });

  it("loads model options from the dynamic catalog instead of a hard-coded hierarchy", async () => {
    render(<SettingsModal {...defaultProps} userApiKey="key-a,key-b" />);

    expect(await screen.findByRole("option", { name: /Gemini Dynamic Stable/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Gemini Dynamic Preview/i })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Gemini 2\.5 Flash/i })).not.toBeInTheDocument();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/translate/models",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ apiKey: "key-a,key-b", force: false }),
      }),
    );
  });

  it("keeps a saved Manual model visible as Unavailable when fresh discovery no longer lists it", async () => {
    render(<SettingsModal {...defaultProps} modelPreference="retired-model" />);

    const option = await screen.findByRole("option", { name: /retired-model.*Unavailable/i });
    expect(option).toHaveValue("retired-model");
    expect(screen.getByLabelText(/Model Preference/i)).toHaveValue("retired-model");
  });

  it("renders five masked key slots and stores the active pool through the existing key string boundary", () => {
    const onChange = vi.fn();
    render(<SettingsModal {...defaultProps} userApiKey="key-a,key-b" onUserApiKeyChange={onChange} />);

    expect(screen.getByLabelText("Gemini API Key")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("API Key 2")).toHaveValue("key-b");
    expect(screen.getByLabelText("API Key 5")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("API Key 3"), { target: { value: "key-c" } });
    expect(onChange).toHaveBeenCalledWith("key-a,key-b,key-c");
  });

  it("Refresh forces live discovery and Preview opt-in is explicit", async () => {
    const onPreview = vi.fn();
    render(<SettingsModal {...defaultProps} userApiKey="key-a" onAllowPreviewModelsChange={onPreview} />);

    await screen.findByRole("option", { name: /Gemini Dynamic Stable/i });
    fireEvent.click(screen.getByRole("button", { name: /รีเฟรชรายการโมเดล/i }));

    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenLastCalledWith(
        "/api/translate/models",
        expect.objectContaining({
          body: JSON.stringify({ apiKey: "key-a", force: true }),
        }),
      );
    });

    fireEvent.click(screen.getByRole("checkbox", { name: /Preview.*Auto/i }));
    expect(onPreview).toHaveBeenCalledWith(true);
  });
});
