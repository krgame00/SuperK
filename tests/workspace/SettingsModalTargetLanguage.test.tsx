import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { SettingsModal, type SettingsModalProps } from "@/components/workspace/SettingsModal";
import { TARGET_LANGUAGES } from "@/lib/languagePolicy";
const props:SettingsModalProps={isOpen:true,onClose:vi.fn(),sourceLang:"auto",onSourceLangChange:vi.fn(),textStyle:{fontFamily:"Itim, sans-serif",fontSizeMultiplier:1,textColor:"#000000",textOutline:"#ffffff"},onTextStyleChange:vi.fn(),modelPreference:"auto",onModelPreferenceChange:vi.fn(),userApiKey:"",onUserApiKeyChange:vi.fn()};
it("offers canonical target/script choices for the next translation job", () => {
  const onChange=vi.fn();
  render(<SettingsModal {...props} targetLang="Thai" onTargetLangChange={onChange}/>);
  const selector=screen.getByRole("combobox",{name:/Target Language/});
  expect(selector).toHaveValue("th");
  expect(within(selector).getAllByRole("option").map(option=>[(option as HTMLOptionElement).value,option.textContent])).toEqual(TARGET_LANGUAGES.map(target=>[target.id,target.label]));
  fireEvent.change(selector,{target:{value:"sr-Latn"}});
  expect(onChange).toHaveBeenCalledWith("sr-Latn");
  expect(screen.getByText(/ภาษาของหน้าที่แปลแล้ว/)).toBeInTheDocument();
});
it("shows an unsupported saved setting as unresolved instead of displaying Thai", () => {
  render(<SettingsModal {...props} targetLang="Chinese" onTargetLangChange={vi.fn()}/>);
  expect(screen.getByRole("combobox",{name:/Target Language/})).toHaveValue("");
  expect(screen.getByRole("alert")).toHaveTextContent("Choose an explicit writing-system variant.");
});
