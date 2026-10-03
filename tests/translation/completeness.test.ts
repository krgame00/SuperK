import { describe, expect, it } from 'vitest';
import { deduplicateTranslations, findMissingTranslationRegions, recoverMissingTranslations } from '@/lib/translation/completeness';
import type { TranslatedBubble } from '@/lib/translationOverlay';
import { TranslationRequestError } from '@/lib/translation/requestError';

const a = [10,10,100,100];
const b = [200,10,300,100];
const scope = {allowed:[a,b],excluded:[]};
const text = (box: number[], t='TEST'): TranslatedBubble => ({box,t});

describe('translation completeness', () => {
  it('retains repeated text in all five distinct regions', () => {
    const input = Array.from({length:5},(_,i)=>text([i*150,10,i*150+100,100]));
    expect(deduplicateTranslations(input)).toEqual(input);
  });
  it('merges only matching text with overlapping geometry and prefers manual ownership', () => {
    const manual = {...text(a),isManual:true};
    expect(deduplicateTranslations([text(a),text([12,12,102,102]),manual,text(a,'OTHER')])).toEqual([manual,text(a,'OTHER')]);
  });
  it('does not throw away repeated entries without reliable boxes', () => {
    expect(deduplicateTranslations(Array.from({length:5},()=>({t:'TEST'})))).toHaveLength(5);
  });
  it('finds missing detected regions and ignores empty or invalid translations', () => {
    expect(findMissingTranslationRegions([text(a),text(b,'')],scope)).toEqual([b]);
    expect(findMissingTranslationRegions([text([0,0,1000,1000])],scope)).toEqual([a,b]);
    expect(findMissingTranslationRegions([{...text(a),isInvalidBox:true}],scope)).toEqual([a,b]);
  });
  it('does not count a small translated fragment as covering an entire detected region', () => {
    expect(findMissingTranslationRegions([text([10,10,30,100])],scope)).toEqual([a,b]);
  });
  it('excludes protected targets and respects deliberate manual deletion', () => {
    expect(findMissingTranslationRegions([{...text(a),deleted:true}],{allowed:[a,b],excluded:[b]})).toEqual([]);
  });
  it('adds only recovered omissions without replacing successful translations', async () => {
    const existing = text(a,'GOOD');
    const visited: number[][] = [];
    const result = await recoverMissingTranslations([existing],scope,async box=>{
      visited.push(box); return [text(b,'RECOVERED'),text([500,500,600,600],'WRONG')];
    });
    expect(visited).toEqual([b]);
    expect(result.bubbles).toEqual([existing,text(b,'RECOVERED')]);
    expect(result.missing).toEqual([]);
  });
  it('a recovered candidate supersedes a partial rendering of the same region', async () => {
    const fragment = text([10,10,30,100],'PART');
    const result = await recoverMissingTranslations([fragment],scope,async box=>[text(box,'FULL')]);
    expect(result.bubbles).toEqual([text(a,'FULL'),text(b,'FULL')]);
    expect(result.missing).toEqual([]);
  });
  it('recovery never supersedes a manual translation overlapping the recovered region', async () => {
    const mine = {...text([10,10,30,100],'MINE'),isManual:true};
    const result = await recoverMissingTranslations([mine],scope,async box=>[text(box,'FULL')]);
    expect(result.bubbles).toEqual([mine,text(a,'FULL'),text(b,'FULL')]);
  });
  it('does not supersede an existing box much larger than the recovered candidate', async () => {
    const wide = text([0,0,190,460],'WIDE');
    const result = await recoverMissingTranslations([wide],scope,async box=>[text(box,'FULL')]);
    expect(result.bubbles).toEqual([wide,text(a,'FULL'),text(b,'FULL')]);
  });
  it('keeps partial successes and stops at six recovery requests', async () => {
    const regions = Array.from({length:8},(_,i)=>[i*110,10,i*110+80,100]);
    let calls=0;
    const result=await recoverMissingTranslations([],{allowed:regions,excluded:[]},async box=>{
      calls++; if(calls===2) throw new Error('transient'); return [text(box)];
    });
    expect(calls).toBe(6);
    expect(result.bubbles).toHaveLength(5);
    expect(result.missing).toHaveLength(3);
  });
  it('stops recovery on safety/quota and propagates cancellation', async () => {
    let calls=0;
    const result=await recoverMissingTranslations([],scope,async()=>{calls++;throw Object.assign(new Error('blocked'),{code:'SAFETY_BLOCKED'});});
    expect(calls).toBe(1);
    expect(result.missing).toEqual([a,b]);
    const controller=new AbortController();controller.abort();
    await expect(recoverMissingTranslations([],scope,async()=>[],controller.signal)).rejects.toMatchObject({name:'AbortError'});
  });
  it('stops on normalized provider quota and propagates provider cancellation without a signalled abort', async () => {
    let calls=0;
    await recoverMissingTranslations([],scope,async()=>{calls++;throw new TranslationRequestError('quota',429);});
    expect(calls).toBe(1);
    await expect(recoverMissingTranslations([],scope,async()=>{throw new TranslationRequestError('cancelled',499,'cancelled');})).rejects.toMatchObject({category:'cancelled'});
  });
});
