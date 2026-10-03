import { describe, expect, it } from 'vitest';
import { resolveBubbleTextStyle } from '@/lib/colorMatching/resolveTextStyle';
import type { TextStyleProfile } from '@/lib/colorMatching/types';
import type { TranslatedBubble } from '@/lib/translationOverlay';

const bubble = (overrides: Partial<TextStyleProfile> = {}): TranslatedBubble => ({
  translated_text: 'ข้อความ', original_text: 'Original',
  styleProfile: { fill: '#159f9d', outline: '#ffffff', hasOutline: true,
    outlineWidthRatio: .13, source: 'auto', evidenceState: 'admitted',
    fillConfidence: .95, outlineConfidence: .95, backgroundLuminance: 180, ...overrides },
});

describe('Original keeps source evidence while Auto uses white artwork interiors', () => {
  it.each(['#159f9d','#930a0b','#f09219'])('preserves recovered %s and its outline', fill => {
    const result = resolveBubbleTextStyle(bubble({fill,ownershipMode:'source_faithful'}));
    expect(result.textColor).toBe(fill);
    expect(result.textOutline).toBe('#ffffff');
    expect(result.isAdaptiveReadable).not.toBe(true);
  });
  it('does not invent an outline for admitted borderless source text', () => {
    const result = resolveBubbleTextStyle(bubble({ownershipMode:'source_faithful',category:'overlay_subtitle',hasOutline:false,outlineWidthRatio:0}));
    expect(result.textColor).toBe('#159f9d');
    expect(result.hasOutline).toBe(false);
  });
  it('preserves an admitted source gradient', () => {
    const fillGradient = {angleDeg:90,stops:[{offset:0,color:'#159f9d'},{offset:1,color:'#930a0b'}]};
    expect(resolveBubbleTextStyle(bubble({fillGradient,ownershipMode:'source_faithful'})).fillGradient).toEqual(fillGradient);
  });
  it('keeps explicit readable and rejected profiles in readable fallback', () => {
    for (const overrides of [{ownershipMode:'readable' as const},{evidenceState:'rejected' as const}]) {
      expect(resolveBubbleTextStyle(bubble(overrides)).textColor).toBe('#ffffff');
    }
  });
  it('respects manual ownership and disabled color matching', () => {
    expect(resolveBubbleTextStyle(bubble({source:'manual',fill:'#321abc'})).textColor).toBe('#321abc');
    expect(resolveBubbleTextStyle(bubble(),{textColor:'#223344'},{autoMatchColors:false}).textColor).toBe('#223344');
  });
  it('requires the existing confidence threshold', () => {
    expect(resolveBubbleTextStyle(bubble({fillConfidence:.8})).textOutline).toBe('#159f9d');
    expect(resolveBubbleTextStyle(bubble({fillConfidence:.79})).textOutline).toBe('#000000');
  });
});
