import { describe, expect, it } from 'vitest';
import { resolveBubbleTextStyle } from '@/lib/colorMatching/resolveTextStyle';
import type { TextStyleProfile } from '@/lib/colorMatching/types';
import type { TranslatedBubble } from '@/lib/translationOverlay';

const bubble = (overrides: Partial<TextStyleProfile> = {}): TranslatedBubble => ({
  original_text: 'TEST', translated_text: 'ทดสอบ',
  styleProfile: { fill: '#930a0b', outline: '#ffffff', hasOutline: false,
    outlineWidthRatio: 0, source: 'auto', evidenceState: 'admitted',
    fillConfidence: .95, outlineConfidence: 0, backgroundLuminance: 180, ...overrides },
});

describe('Auto white artwork presentation', () => {
  it.each(['unknown', 'overlay_subtitle', 'sfx'] as const)('uses white interiors for %s colored text even without a source contour', category => {
    const result = resolveBubbleTextStyle(bubble({ category }));
    expect(result.textColor).toBe('#ffffff');
    expect(result.textOutline).toBe('#930a0b');
    expect(result.hasOutline).toBe(true);
    expect(result.outlineWidthRatio).toBeGreaterThan(0);
  });
  it('resolves both source color roles to the same presentation', () => {
    const inverted = resolveBubbleTextStyle(bubble());
    const white = resolveBubbleTextStyle(bubble({fill:'#ffffff',outline:'#930a0b',hasOutline:true,outlineConfidence:.95}));
    expect(white.textColor).toBe(inverted.textColor);
    expect(white.textOutline).toBe(inverted.textOutline);
  });
  it('strengthens a pale outline and never applies a colored fill gradient', () => {
    const result = resolveBubbleTextStyle(bubble({fill:'#ffddee',fillGradient:{angleDeg:90,stops:[{offset:0,color:'#ff0000'},{offset:1,color:'#00ff00'}]}}));
    expect(result.textColor).toBe('#ffffff');
    expect(result.textOutline).not.toBe('#ffddee');
    expect(result.textOutline).not.toBe('#ffffff');
    expect(result.fillGradient).toBeUndefined();
  });
  it('does not trust contaminated overlay color, including a stale accent', () => {
    const result = resolveBubbleTextStyle(bubble({category:'overlay_subtitle',evidenceState:'rejected',fallbackReason:'background-contamination',sourceAccentColor:'#930a0b'}));
    expect(result.textColor).toBe('#ffffff');
    expect(result.textOutline).toBe('#000000');
  });
  it('does not trust a weak colored contour around reliably detected white ink', () => {
    const result = resolveBubbleTextStyle(bubble({fill:'#ffffff',outline:'#930a0b',hasOutline:true,outlineConfidence:.1}));
    expect(result.textOutline).toBe('#000000');
    expect(result.outlineConfidence).toBeLessThan(.8);
  });
  it('uses an independently retained trustworthy source accent', () => {
    const result = resolveBubbleTextStyle(bubble({fill:'#ffffff',outline:'#000000',sourceAccentColor:'#930a0b'}));
    expect(result.textOutline).toBe('#930a0b');
  });
  it('keeps explicit overlay interiors white on bright backgrounds with weak evidence', () => {
    const result = resolveBubbleTextStyle(bubble({category:'overlay_subtitle',fillConfidence:.4,source:'global',fill:'#000000',backgroundLuminance:250}));
    expect(result.textColor).toBe('#ffffff');
    expect(result.textOutline).toBe('#000000');
  });
  it('uses white interiors for admitted dark-background dialogue', () => {
    expect(resolveBubbleTextStyle(bubble({category:'dialogue',fill:'#000000',backgroundLuminance:40})).textColor).toBe('#ffffff');
  });
  it('retains ordinary black dialogue in white balloons', () => {
    expect(resolveBubbleTextStyle(bubble({category:'dialogue',fill:'#000000',backgroundLuminance:250})).textColor).toBe('#000000');
  });
  it.each(['manual','source_faithful'] as const)('preserves explicit %s ownership', ownershipMode => {
    expect(resolveBubbleTextStyle(bubble({ownershipMode})).textColor).toBe('#930a0b');
  });
  it.each(['source_faithful','readable'] as const)('keeps explicit %s authoritative on monochrome pages', ownershipMode => {
    const result = resolveBubbleTextStyle(bubble({ownershipMode,isMonochromePage:true,monochromeConfidence:.95}));
    expect(result.textColor).toBe(ownershipMode === 'readable' ? '#ffffff' : '#930a0b');
  });
  it('preserves disabled automatic color matching', () => {
    expect(resolveBubbleTextStyle(bubble(),{textColor:'#123456'},{autoMatchColors:false}).textColor).toBe('#123456');
  });
});
