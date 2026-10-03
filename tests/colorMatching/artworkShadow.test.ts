import { describe, expect, it } from 'vitest';
import { resolveBubbleTextStyle, STANDARD_TRANSLATED_TEXT_SHADOW } from '@/lib/colorMatching/resolveTextStyle';
import type { TextStyleCategory, TextStyleProfile } from '@/lib/colorMatching/types';
import type { TranslatedBubble } from '@/lib/translationOverlay';

const bubble = (category: TextStyleCategory, overrides: Partial<TextStyleProfile> = {}): TranslatedBubble => ({
  t: 'TEST', styleProfile: { category, fill:'#930a0b', outline:'#ffffff', source:'auto',
    evidenceState:'admitted', fillConfidence:.95, backgroundLuminance:180, ...overrides },
});

describe('subtle artwork shadow trial', () => {
  it('keeps monochrome SFX ink unchanged while adding the subtle artwork shadow', () => {
    const result = resolveBubbleTextStyle(bubble('sfx', {fill:'#000000', isMonochromePage:true, monochromeConfidence:.95}));
    expect(result.textColor).toBe('#000000');
    expect(result.shadow?.opacity).toBe(.30);
  });
  it.each(['dialogue','narration'] as const)('does not add a shadow to %s text', category => {
    expect(resolveBubbleTextStyle(bubble(category)).shadow).toBeUndefined();
  });
  it.each(['overlay_subtitle','sfx','unknown'] as const)('uses a faint close shadow on %s artwork', category => {
    const result = resolveBubbleTextStyle(bubble(category));
    expect(result.shadow).toEqual({color:'#1e1e1e',opacity:.30,blurRatio:.06,offsetXRatio:.025,offsetYRatio:.025});
    expect(result.glow).toBeUndefined();
    expect(result.readabilityHalo).toBeUndefined();
  });
  it('keeps unknown black text on a light background clean', () => {
    expect(resolveBubbleTextStyle(bubble('unknown',{fill:'#000000',backgroundLuminance:250})).shadow).toBeUndefined();
  });
  it('preserves the same policy for explicit Readable dialogue', () => {
    expect(resolveBubbleTextStyle(bubble('dialogue',{ownershipMode:'readable'})).shadow).toBeUndefined();
  });
  it('keeps Manual Standard/Off and Original authoritative', () => {
    expect(resolveBubbleTextStyle(bubble('dialogue',{source:'manual'})).shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);
    expect(resolveBubbleTextStyle(bubble('dialogue',{source:'manual',manualShadowMode:'off'})).shadow).toBeUndefined();
    expect(resolveBubbleTextStyle(bubble('dialogue',{ownershipMode:'source_faithful'})).shadow).toEqual(STANDARD_TRANSLATED_TEXT_SHADOW);
  });
});
