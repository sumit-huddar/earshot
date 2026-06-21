#!/usr/bin/env node
// Reports how much each saved session is condensed: transcript words vs. summary words.
// Usage: node backend/scripts/compression-report.js

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'summaries.json');

function wordCount(text) {
  return (text || '')
    .replace(/[#*_>`\-|]/g, ' ') // strip common Markdown markup so it doesn't inflate the count
    .split(/\s+/)
    .filter(Boolean).length;
}

function transcriptWords(record) {
  // Prefer the precomputed wordCount; fall back to recomputing from transcripts.
  if (typeof record.wordCount === 'number' && record.wordCount > 0) return record.wordCount;
  const text = (record.transcripts || []).map(t => t.text).join(' ');
  return wordCount(text);
}

const records = JSON.parse(fs.readFileSync(FILE, 'utf8'));
if (!records.length) {
  console.log('No saved sessions found in summaries.json.');
  process.exit(0);
}

let totalIn = 0;
let totalOut = 0;
const rows = [];

for (const r of records) {
  const inWords = transcriptWords(r);
  const outWords = wordCount(r.summary);
  const ratio = outWords ? inWords / outWords : 0;
  totalIn += inWords;
  totalOut += outWords;
  rows.push({
    title: (r.title || 'Untitled').slice(0, 30),
    inWords,
    outWords,
    ratio: ratio ? ratio.toFixed(1) + '×' : 'n/a',
  });
}

// Per-session table
const pad = (s, n) => String(s).padEnd(n);
console.log('\nCompression per session (transcript words -> summary words):\n');
console.log(pad('Session', 32) + pad('Transcript', 12) + pad('Summary', 10) + 'Ratio');
console.log('-'.repeat(60));
for (const row of rows) {
  console.log(pad(row.title, 32) + pad(row.inWords, 12) + pad(row.outWords, 10) + row.ratio);
}

// Overall
const overallRatio = totalOut ? (totalIn / totalOut) : 0;
const avgRatio = rows.reduce((a, r) => a + (parseFloat(r.ratio) || 0), 0) / rows.length;
console.log('-'.repeat(60));
console.log(`\nSessions analyzed:        ${records.length}`);
console.log(`Total transcript words:   ${totalIn}`);
console.log(`Total summary words:      ${totalOut}`);
console.log(`Overall compression:      ${overallRatio.toFixed(1)}×  (all transcript words / all summary words)`);
console.log(`Average per-session:      ${avgRatio.toFixed(1)}×\n`);
