import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const directory = resolve('.superpowers/sdd/oct04-four-spec');
const baseline = JSON.parse(readFileSync(`${directory}/P01-baseline.json`, 'utf8'));
const diagnostic = JSON.parse(readFileSync(`${directory}/P01-diagnostic.json`, 'utf8'));
const events = JSON.parse(readFileSync(`${directory}/P01-diagnostic-trace.json`, 'utf8')).traceEvents;
const names = ['Layout', 'UpdateLayoutTree', 'Paint', 'PrePaint', 'Layerize', 'FireAnimationFrame', 'EventDispatch', 'MinorGC', 'MajorGC'];
const trace = diagnostic.rows.map(row => {
  const output = { label: row.label };
  for (const phase of ['drag', 'release']) {
    const start = events.find(e => e.name === `${row.label}/${phase}-start`);
    const end = events.find(e => e.name === `${row.label}/${phase}-end`);
    if (!start || !end) throw new Error(`Missing trace marks ${row.label}/${phase}`);
    output[phase] = { durationMs: (end.ts - start.ts) / 1000 };
    for (const name of names) {
      const entries = events.filter(e => e.name === name && e.ph === 'X' && e.pid === start.pid && e.tid === start.tid && e.ts >= start.ts && e.ts + e.dur <= end.ts);
      output[phase][name] = { calls: entries.length, totalMs: entries.reduce((n, e) => n + e.dur / 1000, 0), maxMs: Math.max(0, ...entries.map(e => e.dur / 1000)) };
    }
  }
  return output;
});
writeFileSync(`${directory}/P01-trace-summary.json`, JSON.stringify(trace, null, 2));
const f = n => n.toFixed(1);
const table = baseline.rows.map(r => `| ${r.label} | ${f(r.durationMs-r.releaseToSecondFrameMs)} | ${f(r.framesMs.p50)}/${f(r.framesMs.p95)}/${f(r.framesMs.max)} | ${r.missedFrames60Hz} | ${f(r.inputToPreviewMs.p50)}/${f(r.inputToPreviewMs.p95)}/${f(r.inputToPreviewMs.max)} | ${f(r.releaseHandlerMs)} | ${f(r.releaseToSecondFrameMs)} |`).join('\n');
writeFileSync(`${directory}/P01-metrics.md`, `# P01 measured baseline\n\nAll values milliseconds; 60 frame-paced inputs per row.\n\n| Page / points / zoom / gesture | Drag duration | Frame p50/p95/max | Missed 60Hz slots | Input to preview p50/p95/max | Release handler | Release to second rAF |\n|---|---:|---|---:|---|---:|---:|\n${table}\n`);
console.log('Wrote P01-metrics.md and P01-trace-summary.json');
for (const row of trace.filter(r => r.label.startsWith('1600x2400/100/0.44'))) console.log(JSON.stringify(row));
