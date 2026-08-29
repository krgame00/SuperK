import { describe, expect, it } from "vitest";
import {
  applyEditingCommand,
  createDefaultEditingDocument,
  createAddTextLayerCommand,
  createUpdateTextLayerCommand,
  createDeleteTextLayerCommand,
  type TextLayer,
} from "@/lib/editing/commands";

describe("Editing Document Model & Commands", () => {
  it("creates a default empty editing document for a page", () => {
    const doc = createDefaultEditingDocument("page_1");
    expect(doc.pageId).toBe("page_1");
    expect(doc.textLayers).toEqual([]);
    expect(doc.maskLayers).toEqual([]);
    expect(doc.imageLayers).toEqual([]);
    expect(doc.selectedLayerId).toBeNull();
  });

  it("applies and reverts adding a text layer", () => {
    const initial = createDefaultEditingDocument("page_1");
    const textLayer: TextLayer = {
      id: "text_1",
      pageId: "page_1",
      text: "สวัสดีครับ",
      x: 100,
      y: 150,
      width: 200,
      height: 80,
      fontFamily: "var(--font-manga)",
      fontSize: 24,
      color: "#000000",
    };

    const addCommand = createAddTextLayerCommand("page_1", textLayer);
    const addedDoc = applyEditingCommand(initial, addCommand);

    expect(addedDoc.textLayers).toHaveLength(1);
    expect(addedDoc.textLayers[0].text).toBe("สวัสดีครับ");
    expect(addedDoc.selectedLayerId).toBe("text_1");

    // Revert
    const revertedDoc = addCommand.revert(addedDoc);
    expect(revertedDoc.textLayers).toHaveLength(0);
    expect(revertedDoc.selectedLayerId).toBeNull();
  });

  it("applies and reverts updating a text layer property", () => {
    const initial = createDefaultEditingDocument("page_1");
    const textLayer: TextLayer = {
      id: "text_1",
      pageId: "page_1",
      text: "เดิมที",
      x: 50,
      y: 50,
      width: 120,
      height: 60,
      fontFamily: "var(--font-manga)",
      fontSize: 20,
      color: "#000000",
    };
    const withText = applyEditingCommand(
      initial,
      createAddTextLayerCommand("page_1", textLayer),
    );

    const updateCommand = createUpdateTextLayerCommand("page_1", "text_1", {
      text: "แก้ไขใหม่",
      fontSize: 28,
      color: "#ff0000",
    });

    const updatedDoc = applyEditingCommand(withText, updateCommand);
    expect(updatedDoc.textLayers[0].text).toBe("แก้ไขใหม่");
    expect(updatedDoc.textLayers[0].fontSize).toBe(28);
    expect(updatedDoc.textLayers[0].color).toBe("#ff0000");

    // Revert
    const revertedDoc = updateCommand.revert(updatedDoc);
    expect(revertedDoc.textLayers[0].text).toBe("เดิมที");
    expect(revertedDoc.textLayers[0].fontSize).toBe(20);
    expect(revertedDoc.textLayers[0].color).toBe("#000000");
  });

  it("applies and reverts deleting a text layer", () => {
    const initial = createDefaultEditingDocument("page_1");
    const textLayer: TextLayer = {
      id: "text_1",
      pageId: "page_1",
      text: "จะถูกลบ",
      x: 10,
      y: 10,
      width: 100,
      height: 50,
      fontFamily: "var(--font-manga)",
      fontSize: 18,
    };
    const withText = applyEditingCommand(
      initial,
      createAddTextLayerCommand("page_1", textLayer),
    );

    const deleteCommand = createDeleteTextLayerCommand("page_1", "text_1");
    const deletedDoc = applyEditingCommand(withText, deleteCommand);
    expect(deletedDoc.textLayers).toHaveLength(0);
    expect(deletedDoc.selectedLayerId).toBeNull();

    // Revert
    const restoredDoc = deleteCommand.revert(deletedDoc);
    expect(restoredDoc.textLayers).toHaveLength(1);
    expect(restoredDoc.textLayers[0].text).toBe("จะถูกลบ");
  });

  it("maintains strict page isolation", () => {
    const page1 = createDefaultEditingDocument("page_1");
    const page2 = createDefaultEditingDocument("page_2");

    const text1: TextLayer = {
      id: "text_1",
      pageId: "page_1",
      text: "หน้า 1",
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      fontFamily: "sans-serif",
      fontSize: 16,
    };

    const updatedPage1 = applyEditingCommand(
      page1,
      createAddTextLayerCommand("page_1", text1),
    );
    expect(updatedPage1.textLayers).toHaveLength(1);
    expect(page2.textLayers).toHaveLength(0);
  });
});
