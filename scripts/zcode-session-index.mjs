#!/usr/bin/env node
// ดัชนีแชตอัตโนมัติ — รันโดย ZCode Stop hook (ดู .zcode/config.json)
// อ่านฐานข้อมูล session ของ ZCode แบบ read-only แล้วอัปเดตบล็อกดัชนีระหว่าง
// marker "session-index:auto" ใน docs/ZCODE-WORKING-NOTES.md ให้ตรงกับ DB เสมอ
// กติกาสำคัญ: ห้าม throw / ห้ามเขียน stdout — hook ที่พังจะทำให้ session error ได้
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_ENTRIES = 120;
const MAX_TITLE = 70;
const MAX_LAST_USER = 140;

try {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const notesPath = path.join(repoRoot, 'docs', 'ZCODE-WORKING-NOTES.md');
  const dbPath = path.join(os.homedir(), '.zcode', 'cli', 'db', 'db.sqlite');

  const norm = (p) => path.resolve(p).toLowerCase();
  const root = norm(repoRoot);
  const repoName = path.basename(root);
  // repo เคยถูกย้าย (Downloads → F:\Projects) — session เก่าจด path เดิมไว้
  // จับตามชื่อโฟลเดอร์ repo ไม่ใช่ path เดียว เพื่อให้แชตเก่ายังเข้าดัชนี
  const isRepo = (dir) => {
    if (!dir) return false;
    const n = norm(dir);
    return n === root || n.startsWith(root + path.sep) || path.basename(n) === repoName;
  };

  const db = new DatabaseSync(dbPath, { readOnly: true });

  // เฉพาะ session หลักของโปรเจกนี้ (ไม่เอา subagent / ที่ถูกลบ)
  const rows = db
    .prepare(
      "SELECT id, title, directory, time_updated, last_outcome FROM session " +
        "WHERE parent_id IS NULL AND id NOT LIKE 'sess_subagent%' AND time_deleted IS NULL " +
        'ORDER BY time_updated DESC LIMIT 800'
    )
    .all();

  const sessions = rows.filter((r) => isRepo(r.directory)).slice(0, MAX_ENTRIES);

  // ข้อความจริงล่าสุดของผู้ใช้ (origin = real_user, ไม่เอา synthetic/system reminder)
  const lastUserText = (sessionId) => {
    const msgs = db
      .prepare(
        "SELECT id, data FROM message WHERE session_id = ? AND data LIKE '%\"role\":\"user\"%' " +
          'ORDER BY sequence DESC LIMIT 25'
      )
      .all(sessionId);
    for (const m of msgs) {
      try {
        const d = JSON.parse(m.data);
        if (d?.semantics?.origin !== 'real_user') continue;
        const parts = db
          .prepare("SELECT data FROM part WHERE message_id = ? AND data LIKE '%\"type\":\"text\"%' ORDER BY sequence")
          .all(m.id);
        for (const p of parts) {
          const j = JSON.parse(p.data);
          if (j?.type === 'text' && !j.synthetic && j.text) return String(j.text).replace(/\s+/g, ' ').trim();
        }
      } catch {
        /* ข้าม message ที่ parse ไม่ได้ */
      }
    }
    return '';
  };

  const fmt = new Intl.DateTimeFormat('th-TH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const when = (ms) => fmt.format(new Date(ms)).replace(/,/g, '');
  const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const outcome = (o) => (o === 'completed' ? '✅' : o === 'error' ? '⚠️' : o || '—');

  const lines = sessions.map((s) => {
    const shortId = String(s.id).replace(/^sess(?:ion)?_/, '').slice(0, 8);
    const title = clip(String(s.title || '(ไม่มีชื่อ)').replace(/\s+/g, ' ').trim(), MAX_TITLE);
    const last = clip(lastUserText(s.id), MAX_LAST_USER);
    return `- ${when(s.time_updated)} · \`${shortId}\` · "${title}" · ${outcome(s.last_outcome)}${last ? ` · ↳ "${last}"` : ''}`;
  });
  db.close();

  const block =
    `<!-- session-index:auto:start -->\n` +
    `## 📇 ดัชนีแชตอัตโนมัติ (Stop hook — ห้ามแก้มือ)\n\n` +
    `อัปเดตอัตโนมัติจากฐานข้อมูล ZCode ทุกครั้งที่ AI ตอบจบรอบ (ใหม่→เก่า, สูงสุด ${MAX_ENTRIES} รายการ) — ` +
    `แชตไหนหายจาก UI ให้ยก session id ในรายการนี้ให้ AI เพื่อกู้คืนเนื้อหาเต็มจากฐานข้อมูล\n\n` +
    lines.join('\n') +
    `\n<!-- session-index:auto:end -->`;

  const START = '<!-- session-index:auto:start -->';
  const END = '<!-- session-index:auto:end -->';
  let content = '';
  try {
    content = fs.readFileSync(notesPath, 'utf8');
  } catch {
    content = `# ZCode Working Notes — SuperK / Manga Translator\n`;
  }

  let next;
  const si = content.indexOf(START);
  const ei = content.indexOf(END);
  if (si !== -1 && ei !== -1 && ei > si) {
    next = content.slice(0, si) + block + content.slice(ei + END.length);
  } else {
    // ยังไม่มีบล็อก — แทรกไว้ใต้หัวไฟล์บรรทัดแรก
    const nl = content.indexOf('\n');
    const head = nl === -1 ? content : content.slice(0, nl);
    next = head + '\n\n' + block + content.slice(nl === -1 ? content.length : nl);
  }

  if (next !== content) fs.writeFileSync(notesPath, next, 'utf8');
} catch {
  /* ดัชนีพังได้ — ห้ามกระทบ session */
}
process.exit(0);
