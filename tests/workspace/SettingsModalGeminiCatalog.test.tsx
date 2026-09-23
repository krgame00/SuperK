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
  validKeys: 2,
  keys: [
    { slot: 1, owner: "user", valid: true, modelCount: 2 },
    { slot: 2, owner: "server", valid: true, modelCount: 1 },
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
      status: "ready",
      recoveryInFlight: false,
      compatibility: { text: "compatible", image: "compatible" },
    },
    {
      id: "gemini-dynamic-preview",
      displayName: "Gemini Dynamic Preview",
      releaseChannel: "preview",
      availabilityCount: 1,
      totalKeys: 2,
      cooldownKeys: 1,
      status: "partial_quota",
      nextRetryAt: 12_000,
      recoveryInFlight: false,
      compatibility: { text: "unverified", image: "unverified" },
    },
    {
      id: "gemini-unavailable",
      displayName: "Gemini Unavailable",
      releaseChannel: "stable",
      availabilityCount: 0,
      totalKeys: 2,
      cooldownKeys: 0,
      status: "ready",
      recoveryInFlight: false,
      compatibility: { text: "compatible", image: "compatible" },
    },
    {
      id: "gemini-incompatible",
      displayName: "Gemini Incompatible",
      releaseChannel: "stable",
      availabilityCount: 2,
      totalKeys: 2,
      cooldownKeys: 0,
      status: "ready",
      recoveryInFlight: false,
      compatibility: { text: "compatible", image: "incompatible" },
    },
    {
      id: "gemini-3.6-flash",
      displayName: "Gemini 3.6 Flash",
      releaseChannel: "stable",
      availabilityCount: 2,
      totalKeys: 2,
      cooldownKeys: 0,
      status: "high_demand",
      overloadUntil: 30_000,
      recoveryInFlight: false,
      compatibility: { text: "compatible", image: "unverified" },
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

  it("loads model options in a constrained searchable picker instead of a native select", async () => {
    render(<SettingsModal {...defaultProps} userApiKey="key-a,key-b" />);

    const trigger = screen.getByRole("button", { name: /Model Preference/i });
    fireEvent.click(trigger);

    const listbox = await screen.findByRole("listbox", { name: /รายการโมเดล Gemini/i });
    expect(listbox).toHaveClass("max-h-64", "overflow-y-auto");
    expect(screen.getByRole("searchbox", { name: /ค้นหาโมเดล/i })).toBeInTheDocument();
    expect(await screen.findByRole("option", { name: /Gemini Dynamic Stable/i })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Gemini Dynamic Preview/i })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: /Gemini 3\.6 Flash.*Experimental \/ Unstable/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("ยังไม่ยืนยันเสถียรกับงานแปลภาพ")).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Gemini Unavailable/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Gemini Incompatible/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Gemini 2\.5 Flash/i })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox", { name: /ค้นหาโมเดล/i }), {
      target: { value: "preview" },
    });
    expect(screen.queryByRole("option", { name: /Gemini Dynamic Stable/i })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Gemini Dynamic Preview/i })).toBeInTheDocument();

    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/translate/models",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ apiKey: "key-a,key-b", force: false }),
      }),
    );
  });

  it("keeps a saved Manual model visible as Unavailable and offers an explicit switch to Auto", async () => {
    const onModelPreferenceChange = vi.fn();
    render(
      <SettingsModal
        {...defaultProps}
        modelPreference="retired-model"
        onModelPreferenceChange={onModelPreferenceChange}
      />,
    );

    const trigger = screen.getByRole("button", { name: /Model Preference/i });
    expect(trigger).toHaveTextContent("retired-model");
    fireEvent.click(trigger);

    await waitFor(() => expect(trigger).toHaveTextContent(/retired-model.*Unavailable/i));
    expect(screen.queryByRole("option", { name: /retired-model/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "เปลี่ยนเป็น Auto" }));
    expect(onModelPreferenceChange).toHaveBeenCalledWith("auto");
  });

  it("renders ten masked key slots and stores the active pool through the existing key string boundary", () => {
    const onChange = vi.fn();
    render(<SettingsModal {...defaultProps} userApiKey="key-a,key-b" onUserApiKeyChange={onChange} />);

    expect(screen.getByLabelText("Gemini API Key")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("API Key 2")).toHaveValue("key-b");
    expect(screen.getByLabelText("API Key 10")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("API Key 3"), { target: { value: "key-c" } });
    expect(onChange).toHaveBeenCalledWith("key-a,key-b,key-c");
  });

  it("Refresh forces live discovery and Preview opt-in is explicit", async () => {
    const onPreview = vi.fn();
    render(<SettingsModal {...defaultProps} userApiKey="key-a" onAllowPreviewModelsChange={onPreview} />);

    await waitFor(() =>
      expect(screen.getByText(/Credentials 2\/2 valid · 3 ใช้ได้ จาก 5 โมเดล/i))
        .toBeInTheDocument(),
    );
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
