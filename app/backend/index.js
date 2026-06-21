require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { transcribeChunk, isNoise } = require('./services/transcriber');
const { summarizeMeeting, answerFromHistory, MODES } = require('./services/summarizer');
const { embed, rank } = require('./services/embeddings');
const { saveSummary, listSummaries, allWithEmbeddings, getSummary, deleteSummary } = require('./services/storage');

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

// In-memory live sessions
const sessions = {};

// ── Start a capture session ──────────────────────────────────────────────────
app.post('/api/sessions', (req, res) => {
  const { title, mode } = req.body;
  const sessionId = uuidv4();
  sessions[sessionId] = {
    sessionId,
    title: title?.trim() || 'Untitled Session',
    mode: MODES[mode] ? mode : 'meeting',
    transcripts: [],
    status: 'active',
    startTime: new Date().toISOString(),
  };
  res.json({ sessionId, status: 'active' });
});

// List available capture modes (for the UI)
app.get('/api/modes', (_, res) => {
  res.json(Object.keys(MODES).map(key => ({ key, label: key })));
});

// ── Receive one audio chunk, transcribe it, append to the live transcript ─────
app.post('/api/sessions/:id/audio', upload.single('audio'), async (req, res) => {
  const s = sessions[req.params.id];
  if (!s) return res.status(404).json({ error: 'Session not found' });
  if (!req.file) return res.status(400).json({ error: 'No audio uploaded' });

  try {
    const text = await transcribeChunk(req.file.buffer, 'chunk.webm');
    if (text && !isNoise(text)) {
      const entry = { text, timestamp: new Date().toISOString() };
      s.transcripts.push(entry);
      return res.json({ text, added: true });
    }
    res.json({ text: '', added: false });
  } catch (e) {
    console.error('Transcription error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Poll live transcript ──────────────────────────────────────────────────────
app.get('/api/sessions/:id', (req, res) => {
  const s = sessions[req.params.id];
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json({ sessionId: s.sessionId, status: s.status, title: s.title, startTime: s.startTime, transcripts: s.transcripts });
});

// ── Stop + summarize ──────────────────────────────────────────────────────────
app.post('/api/sessions/:id/stop', async (req, res) => {
  const s = sessions[req.params.id];
  if (!s) return res.status(404).json({ error: 'Not found' });

  try {
    const transcripts = s.transcripts.length > 0
      ? s.transcripts
      : [{ text: 'No speech was captured during this meeting.', timestamp: new Date().toISOString() }];

    const summary = await summarizeMeeting(transcripts, s.title, s.mode);
    const endTime = new Date().toISOString();
    const wordCount = s.transcripts.reduce((acc, t) => acc + t.text.split(/\s+/).filter(Boolean).length, 0);
    const durationMin = Math.max(1, Math.round((new Date(endTime) - new Date(s.startTime)) / 60000));

    // Embed the session so it becomes searchable. Never let this block the response.
    let embedding = [];
    try {
      const transcriptText = s.transcripts.map(t => t.text).join(' ');
      embedding = await embed(`${s.title}\n\n${summary}\n\n${transcriptText}`);
    } catch (e) {
      console.error('Embedding error (non-fatal):', e.message);
    }

    const data = {
      title: s.title,
      mode: s.mode,
      startTime: s.startTime,
      endTime,
      transcripts: s.transcripts,
      summary,
      embedding,
      wordCount,
      durationMin,
    };
    await saveSummary(s.sessionId, data);
    s.status = 'completed';

    // Don't ship the embedding vector back to the browser.
    const { embedding: _omit, ...response } = data;
    res.json({ sessionId: s.sessionId, ...response });
    delete sessions[s.sessionId];
  } catch (e) {
    console.error('Summary error:', e.message);
    res.status(500).json({ error: 'Failed to summarize: ' + e.message });
  }
});

// ── Saved summaries ───────────────────────────────────────────────────────────
app.get('/api/summaries', async (req, res) => {
  try { res.json(await listSummaries()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/summaries/:id', async (req, res) => {
  try { res.json(await getSummary(req.params.id)); }
  catch { res.status(404).json({ error: 'Not found' }); }
});

app.delete('/api/summaries/:id', async (req, res) => {
  try {
    await deleteSummary(req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Semantic search across all saved sessions (RAG) ──────────────────────────
app.post('/api/search', async (req, res) => {
  const question = (req.body.query || '').trim();
  if (!question) return res.status(400).json({ error: 'query is required' });

  try {
    const all = await allWithEmbeddings();
    if (!all.length) {
      return res.json({ answer: 'You have no saved sessions yet. Capture a meeting first, then come back to search.', matches: [] });
    }

    const queryVec = await embed(question);
    const top = rank(queryVec, all, 4).filter(m => m._score > 0.15);

    if (!top.length) {
      return res.json({ answer: "I couldn't find anything relevant to that in your saved sessions.", matches: [] });
    }

    const answer = await answerFromHistory(question, top);

    // Return lightweight match metadata (no embeddings, no full transcript).
    const matches = top.map(m => ({
      sessionId: m.sessionId,
      title: m.title,
      mode: m.mode,
      createdAt: m.createdAt,
      startTime: m.startTime,
      score: Math.round(m._score * 100),
    }));

    res.json({ answer, matches });
  } catch (e) {
    console.error('Search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/health', (_, res) => res.json({ ok: true }));

app.listen(process.env.PORT || 3001, () => console.log('Server running on port', process.env.PORT || 3001));
