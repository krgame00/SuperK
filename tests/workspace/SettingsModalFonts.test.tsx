import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";
import { resolveCanvasFontFamily } from "@/lib/translationOverlay";
import {
  BUILTIN_MANGA_FONTS,
  sanitizeCustomFontFamilyName,
  registerCustomFontFromFile,
  listCustomFonts,
  removeCustomFont,
  clearAllCustomFontsForTests,
} from "@/lib/customFonts";

const defaultProps: SettingsModalProps = {
  isOpen: true,
  onClose: vi.fn(),
  sourceLang: "ja",
  onSourceLangChange: vi.fn(),
  textStyle: {
    fontFamily: "Itim, sans-serif",
    fontSizeMultiplier: 1,
    textColor: "#000000",
    textOutline: "#FFFFFF",
  },
  onTextStyleChange: vi.fn(),
  modelPreference: "gemini-3.5-flash-lite",
  onModelPreferenceChange: vi.fn(),
  userApiKey: "",
  onUserApiKeyChange: vi.fn(),
  autoProceedOnReview: true,
  onAutoProceedOnReviewChange: vi.fn(),
};

describe("Thai Manga Font Pack & Custom Font Upload", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await clearAllCustomFontsForTests();
  });

  it("includes all 16 built-in Thai manga fonts and maps their CSS variables in resolveCanvasFontFamily", () => {
    expect(BUILTIN_MANGA_FONTS.length).toBeGreaterThanOrEqual(16);

    const expectedFamilies = [
      { family: "Itim, sans-serif", cssVar: "--font-itim" },
      { family: "Mali, sans-serif", cssVar: "--font-mali" },
      { family: "Sriracha, sans-serif", cssVar: "--font-sriracha" },
      { family: "Charm, sans-serif", cssVar: "--font-charm" },
      { family: "Pattaya, sans-serif", cssVar: "--font-pattaya" },
      { family: "Mitr, sans-serif", cssVar: "--font-mitr" },
      { family: "Kodchasan, sans-serif", cssVar: "--font-kodchasan" },
      { family: "Kanit, sans-serif", cssVar: "--font-kanit" },
      { family: "Prompt, sans-serif", cssVar: "--font-prompt" },
      { family: "Bai Jamjuree, sans-serif", cssVar: "--font-bai-jamjuree" },
      { family: "IBM Plex Sans Thai, sans-serif", cssVar: "--font-ibm-plex-sans-thai" },
      { family: "Chakra Petch, sans-serif", cssVar: "--font-chakra-petch" },
      { family: "K2D, sans-serif", cssVar: "--font-k2d" },
      { family: "Chonburi, sans-serif", cssVar: "--font-chonburi" },
      { family: "Sarabun, sans-serif", cssVar: "--font-sarabun" },
      { family: "Pridi, serif", cssVar: "--font-pridi" },
    ];

    for (const item of expectedFamilies) {
      document.documentElement.style.setProperty(item.cssVar, `"__Next_${item.cssVar}"`);
      expect(resolveCanvasFontFamily(item.family)).toBe(`"__Next_${item.cssVar}"`);
      document.documentElement.style.removeProperty(item.cssVar);
    }
  });

  it("sanitizes custom font filenames into clean CSS font-family names", () => {
    expect(sanitizeCustomFontFamilyName("Layiji-MaHaNiYom_Bold.ttf")).toBe("Layiji MaHaNiYom Bold");
    expect(sanitizeCustomFontFamilyName("FC_Minimal_Regular (1).otf")).toBe("FC Minimal Regular 1");
  });

  it("renders a Model-Picker-style Font Picker button, opens the searchable categorized listbox with live font previews, and selects a font", () => {
    const onTextStyleChange = vi.fn();
    render(<SettingsModal {...defaultProps} onTextStyleChange={onTextStyleChange} />);

    // 1. Trigger button matches Model Preference style (button with aria-haspopup="listbox")
    const triggerBtn = screen.getByLabelText("Font Family (แบบอักษร)");
    expect(triggerBtn).toBeInTheDocument();
    expect(triggerBtn.id).toBe("settings-font-family");
    expect(triggerBtn.getAttribute("aria-haspopup")).toBe("listbox");
    expect(triggerBtn.getAttribute("aria-expanded")).toBe("false");

    // 2. Live preview box is visible
    const previewBox = screen.getByTestId("font-preview-box");
    expect(previewBox).toBeInTheDocument();

    // 3. Clicking trigger button opens the custom Font Picker listbox + search box
    fireEvent.click(triggerBtn);
    expect(triggerBtn.getAttribute("aria-expanded")).toBe("true");

    const listbox = screen.getByRole("listbox", { name: "รายการแบบอักษร" });
    expect(listbox).toBeInTheDocument();

    const searchInput = screen.getByRole("searchbox", { name: "ค้นหาฟอนต์" });
    expect(searchInput).toBeInTheDocument();

    // All 16 built-in fonts are present as options inside the font listbox
    const options = within(listbox).getAllByRole("option");
    expect(options.length).toBe(16);

    // 4. Category filter pills filter the listbox
    const actionCategoryBtn = screen.getByRole("button", { name: /แอ็กชัน/i });
    fireEvent.click(actionCategoryBtn);
    const actionOptions = within(listbox).getAllByRole("option");
    expect(actionOptions.length).toBe(3); // Chakra Petch, K2D, Chonburi

    // Reset filter back to All
    const allCategoryBtn = screen.getByRole("button", { name: /^ทั้งหมด/i });
    fireEvent.click(allCategoryBtn);

    // 5. Search box filters by Thai style description or font name
    fireEvent.change(searchInput, { target: { value: "โชเน็น" } });
    const filteredOptions = within(listbox).getAllByRole("option");
    expect(filteredOptions.length).toBe(1);
    expect(filteredOptions[0].textContent).toContain("Sriracha");

    // 6. Clicking an option updates fontFamily and closes the listbox
    fireEvent.click(filteredOptions[0]);
    expect(onTextStyleChange).toHaveBeenCalled();
    const updater = onTextStyleChange.mock.calls[0][0];
    const updatedStyle = typeof updater === "function" ? updater(defaultProps.textStyle) : updater;
    expect(updatedStyle.fontFamily).toBe("Sriracha, sans-serif");
    expect(triggerBtn.getAttribute("aria-expanded")).toBe("false");
  });

  it("allows uploading a custom .ttf/.otf font in SettingsModal, selects it automatically, and allows removing it", async () => {
    const onTextStyleChange = vi.fn();
    render(<SettingsModal {...defaultProps} onTextStyleChange={onTextStyleChange} />);

    const fileInput = screen.getByTestId("custom-font-upload-input") as HTMLInputElement;
    expect(fileInput).toBeInTheDocument();

    const fakeFontBytes = new Uint8Array([0x00, 0x01, 0x00, 0x00, 0x00, 0x0a]);
    const fakeFile = new File([fakeFontBytes], "Layiji-MaHaNiYom.ttf", {
      type: "font/ttf",
    });

    fireEvent.change(fileInput, { target: { files: [fakeFile] } });

    await waitFor(() => {
      expect(onTextStyleChange).toHaveBeenCalled();
    });

    const updater = onTextStyleChange.mock.calls[0][0];
    const updatedStyle = typeof updater === "function" ? updater(defaultProps.textStyle) : updater;
    expect(updatedStyle.fontFamily).toContain("Layiji MaHaNiYom");

    const customFonts = await listCustomFonts();
    expect(customFonts).toHaveLength(1);
    expect(customFonts[0].familyName).toBe("Layiji MaHaNiYom");

    // Verify delete button removes it
    const removeBtn = await screen.findByRole("button", { name: /ลบฟอนต์ Layiji MaHaNiYom/i });
    fireEvent.click(removeBtn);

    await waitFor(async () => {
      const remaining = await listCustomFonts();
      expect(remaining).toHaveLength(0);
    });
  });
});
