'use client';
import type {TranslatedBubble} from '@/lib/translationOverlay';
import {useState} from 'react';
export interface SavedSizeAction {scope:'point'|'page'|'book';pageUrl?:string;pointIndex?:number;returnToAuto?:boolean}
export function SavedTextSizeControls({pageUrl,points,busy,onResize}:{pageUrl?:string;points:TranslatedBubble[];busy:boolean;onResize:(options:SavedSizeAction)=>Promise<number>}) {
  const [selected,setSelected]=useState('');
  const [running,setRunning]=useState(false);
  const [message,setMessage]=useState('');
  const disabled=busy||running||!pageUrl;
  const hasPoint=selected!==''&&!!points[Number(selected)]&&!points[Number(selected)].deleted;
  const run=async(options:SavedSizeAction)=>{
    if(disabled)return;
    setRunning(true);
    try {const count=await onResize(options);setMessage(count?`ปรับแล้ว ${count} จุด · ขนาดที่ตั้งเองคงไว้จนเลือกกลับเป็น Auto`:'ไม่มีจุดที่ปรับได้ · เลือกจุดเพื่อกลับเป็น Auto');}
    catch {setMessage('ปรับขนาดไม่สำเร็จ กรุณาลองอีกครั้ง');}
    finally {setRunning(false);}
  };
  const cls='px-2 py-1 rounded border border-border text-xs hover:bg-surface disabled:opacity-40';
  return <details className="relative text-xs">
    <summary className={cls}>ขนาดข้อความ</summary>
    <div className="absolute right-0 top-full z-40 mt-2 p-3 w-80 rounded-xl border border-border bg-background shadow-xl flex flex-col gap-2">
      <p>เทียบขนาดกับต้นฉบับ · จุดที่ตั้งขนาดเองจะไม่ถูกทับ</p>
      <select aria-label="เลือกจุดปรับขนาด" value={selected} onChange={e=>setSelected(e.target.value)} disabled={disabled} className="bg-surface rounded p-2">
        <option value="">เลือกจุด…</option>
        {points.map((point,index)=>point.deleted?null:<option key={index} value={index}>#{index+1} {(point.t||point.translated||'').slice(0,32)} · {point.sourceSizing?.mode==='manual'?'ตั้งเอง':point.sourceSizing?.status==='matched'?'Auto':'ยังไม่ได้เทียบ'}</option>)}
      </select>
      <button type="button" className={cls} disabled={disabled||!hasPoint} onClick={()=>void run({scope:'point',pageUrl,pointIndex:Number(selected)})}>เทียบขนาดจุดที่เลือก</button>
      <button type="button" className={cls} disabled={disabled||!hasPoint} onClick={()=>void run({scope:'point',pageUrl,pointIndex:Number(selected),returnToAuto:true})}>กลับเป็น Auto จุดที่เลือก</button>
      <div className="flex gap-2"><button type="button" className={cls} disabled={disabled} onClick={()=>void run({scope:'page',pageUrl})}>เทียบขนาดหน้านี้</button><button type="button" className={cls} disabled={disabled} onClick={()=>void run({scope:'book'})}>เทียบขนาดทั้งเล่ม</button></div>
      <p role="status">{message}</p>
    </div>
  </details>;
}
