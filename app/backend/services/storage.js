const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// ── Local file fallback (used when MongoDB is unavailable) ─────────────────
const LOCAL_FILE = path.join(__dirname, '..', 'summaries.json');

function readLocal() {
  if (!fs.existsSync(LOCAL_FILE)) return [];
  return JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8'));
}

function writeLocal(records) {
  fs.writeFileSync(LOCAL_FILE, JSON.stringify(records, null, 2));
}

// ── MongoDB (optional) ─────────────────────────────────────────────────────
const summarySchema = new mongoose.Schema({
  sessionId: String,
  title: String,
  mode: String,
  startTime: String,
  endTime: String,
  transcripts: Array,
  summary: String,
  embedding: [Number],
  wordCount: Number,
  durationMin: Number,
  createdAt: { type: Date, default: Date.now },
});

const Summary = mongoose.models.Summary || mongoose.model('Summary', summarySchema);

let mongoOk = null; // null = untested, true/false = result

async function tryMongo() {
  if (mongoOk !== null) return mongoOk;
  if (!process.env.MONGODB_URI) { mongoOk = false; return false; }
  try {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    }
    mongoOk = true;
    console.log('[Storage] Connected to MongoDB');
  } catch (e) {
    mongoOk = false;
    console.warn('[Storage] MongoDB unavailable, using local JSON file:', e.message.split('\n')[0]);
  }
  return mongoOk;
}

// ── Public API ──────────────────────────────────────────────────────────────
async function saveSummary(sessionId, data) {
  const record = { sessionId, ...data, createdAt: new Date().toISOString() };
  if (await tryMongo()) {
    await Summary.create(record);
  } else {
    const records = readLocal();
    const idx = records.findIndex(r => r.sessionId === sessionId);
    if (idx >= 0) records[idx] = record; else records.unshift(record);
    writeLocal(records);
  }
}

async function listSummaries() {
  // Exclude the embedding to keep the list payload small.
  if (await tryMongo()) return Summary.find().select('-embedding').sort({ createdAt: -1 });
  return readLocal()
    .map(({ embedding, ...rest }) => rest)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// Full records including embeddings — used for semantic search.
async function allWithEmbeddings() {
  if (await tryMongo()) return (await Summary.find().lean()).map(r => r);
  return readLocal();
}

async function getSummary(sessionId) {
  if (await tryMongo()) return Summary.findOne({ sessionId });
  return readLocal().find(r => r.sessionId === sessionId) || null;
}

async function deleteSummary(sessionId) {
  if (await tryMongo()) {
    await Summary.deleteOne({ sessionId });
  } else {
    writeLocal(readLocal().filter(r => r.sessionId !== sessionId));
  }
}

module.exports = { saveSummary, listSummaries, allWithEmbeddings, getSummary, deleteSummary };
