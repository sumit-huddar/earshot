import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Mic, Square, Clock, FileText, Trash2,
  Copy, Check, ArrowLeft, Loader2, MonitorSpeaker,
  Users, GraduationCap, Podcast, MessageSquare, Search, Sparkles, AudioLines,
} from 'lucide-react';
import { startSession, sendAudioChunk, stopSession, getSummaries, getSummary, deleteSummary, searchHistory } from './api';

const CHUNK_MS = 15000; // length of each audio slice sent for transcription

const MODES = [
  { key: 'meeting',   label: 'Meeting',   icon: Users,         hint: 'Decisions & action items' },
  { key: 'lecture',   label: 'Lecture',   icon: GraduationCap, hint: 'Study notes & concepts' },
  { key: 'podcast',   label: 'Podcast',   icon: Podcast,       hint: 'Takeaways & references' },
  { key: 'interview', label: 'Interview', icon: MessageSquare, hint: 'Q&A & assessment' },
];

export default function App() {
  const [view, setView] = useState('home');
  const [meetTitle, setMeetTitle] = useState('');
  const [mode, setMode] = useState('meeting');
  const [sessionId, setSessionId] = useState(null);

  // semantic search ("Ask")
  const [askQuery, setAskQuery] = useState('');
  const [askAnswer, setAskAnswer] = useState('');
  const [askMatches, setAskMatches] = useState([]);
  const [askLoading, setAskLoading] = useState(false);
  const [askDone, setAskDone] = useState(false);

  const [liveTranscripts, setLiveTranscripts] = useState([]);
  const [summaries, setSummaries] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const transcriptRef = useRef(null);
  const streamRef = useRef(null);    // the full display stream (to stop all tracks)
  const activeRef = useRef(false);    // whether capture loop should continue
  const sessionRef = useRef(null);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [liveTranscripts]);

  // ── recording loop: each cycle = one complete webm blob → backend ──────────
  const recordCycle = (audioStream, sid) => {
    if (!activeRef.current) return;
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(audioStream, { mimeType: mime });
    const parts = [];

    rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };

    rec.onstop = async () => {
      const blob = new Blob(parts, { type: 'audio/webm' });
      if (blob.size > 1200) {
        try {
          setTranscribing(true);
          const { data } = await sendAudioChunk(sid, blob);
          if (data.added && data.text) {
            setLiveTranscripts(prev => [...prev, { text: data.text, timestamp: new Date().toISOString() }]);
          }
        } catch { /* keep going on a failed chunk */ }
        finally { setTranscribing(false); }
      }
      if (activeRef.current) recordCycle(audioStream, sid); // next slice
    };

    rec.start();
    setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, CHUNK_MS);
  };

  // ── Start capture ──────────────────────────────────────────────────────────
  const handleStart = async () => {
    setError('');
    let display;
    try {
      // Must be called directly in the click gesture
      display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    } catch {
      setError('Screen share was cancelled. Click Start and choose your meeting tab.');
      return;
    }

    const audioTracks = display.getAudioTracks();
    if (audioTracks.length === 0) {
      display.getTracks().forEach(t => t.stop());
      setError('No audio was shared. When picking the tab, you must tick the “Share tab audio” checkbox.');
      return;
    }

    setLoading(true);
    try {
      const { data } = await startSession(meetTitle.trim() || 'My Session', mode);
      const sid = data.sessionId;
      setSessionId(sid);
      sessionRef.current = sid;
      setLiveTranscripts([]);

      streamRef.current = display;
      activeRef.current = true;

      // Auto-stop if user clicks the browser's native "Stop sharing"
      display.getVideoTracks().forEach(t => { t.onended = () => handleStop(); });
      audioTracks.forEach(t => { t.onended = () => handleStop(); });

      const audioStream = new MediaStream(audioTracks);
      recordCycle(audioStream, sid);

      setView('active');
    } catch (e) {
      display.getTracks().forEach(t => t.stop());
      setError(e.response?.data?.error || 'Failed to start session.');
    }
    setLoading(false);
  };

  // ── Stop + summarize ─────────────────────────────────────────────────────────
  const handleStop = async () => {
    if (!activeRef.current && view !== 'active') return;
    activeRef.current = false;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    const sid = sessionRef.current;
    if (!sid) return;

    setLoading(true);
    try {
      const { data } = await stopSession(sid);
      setSelected(data);
      setView('detail');
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to generate summary. Please try again.');
      setView('home');
    }
    setLoading(false);
    sessionRef.current = null;
  };

  const loadSummaries = async () => {
    setLoading(true);
    try { const { data } = await getSummaries(); setSummaries(data); } catch {}
    setLoading(false);
  };

  const handleAsk = async () => {
    const q = askQuery.trim();
    if (!q) return;
    setAskLoading(true); setAskDone(false); setAskAnswer(''); setAskMatches([]);
    try {
      const { data } = await searchHistory(q);
      setAskAnswer(data.answer || '');
      setAskMatches(data.matches || []);
    } catch (e) {
      setAskAnswer('Search failed: ' + (e.response?.data?.error || e.message));
    }
    setAskDone(true);
    setAskLoading(false);
  };

  const handleCopy = async (text) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  };

  const openSummary = async (sessionId) => {
    try { const { data } = await getSummary(sessionId); setSelected(data); setView('detail'); } catch {}
  };

  const nav = (v) => { setView(v); setError(''); if (v === 'summaries') loadSummaries(); };

  const formatDate = (d) =>
    d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  const navItems = [['home', 'New'], ['ask', 'Ask AI'], ['summaries', 'Library']];
  const isActive = (v) => view === v || (v === 'summaries' && view === 'detail');

  return (
    <div>
      {/* ── Header ── */}
      <header className="header">
        <div className="header-inner">
          <button className="brand" onClick={() => nav('home')}>
            <span className="brand-logo"><AudioLines size={17} color="#fff" /></span>
            Earshot
          </button>
          <nav className="nav">
            {navItems.map(([v, label]) => (
              <button key={v} className={`nav-btn ${isActive(v) ? 'active' : ''}`} onClick={() => nav(v)}>
                {label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="container">

        {/* ── Home ── */}
        {view === 'home' && (
          <div className="view">
            <h1 className="h1">Your second brain<br />for anything you hear</h1>
            <p className="lead" style={{ marginBottom: 30 }}>
              Share any tab&apos;s audio — a meeting, lecture, podcast, or interview — and Earshot transcribes it live,
              writes a clean summary, and makes every word searchable forever.
            </p>

            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="card card-pad stack" style={{ gap: 22 }}>
              <div>
                <label className="field-label">What are you capturing?</label>
                <div className="mode-grid">
                  {MODES.map(m => {
                    const Icon = m.icon;
                    return (
                      <button
                        key={m.key}
                        className={`mode-card m-${m.key} ${mode === m.key ? 'active' : ''}`}
                        onClick={() => setMode(m.key)}
                      >
                        <Icon size={18} className="mode-icon" />
                        <div style={{ minWidth: 0 }}>
                          <div className="mode-name">{m.label}</div>
                          <div className="mode-hint">{m.hint}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="field-label">Title</label>
                <input
                  className="input"
                  placeholder="e.g. Weekly Standup"
                  value={meetTitle}
                  onChange={e => setMeetTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !loading && handleStart()}
                />
              </div>

              <Btn onClick={handleStart} loading={loading} loadingText="Starting…" icon={<MonitorSpeaker size={16} />}>
                Start Capture
              </Btn>
            </div>

            <div className="card card-pad" style={{ marginTop: 18 }}>
              <div className="howto-title">How it works</div>
              <ol className="steps">
                <li>Join your meeting (or open any tab that plays audio) in another tab</li>
                <li>Click <strong>Start Capture</strong> and pick that tab in the share picker</li>
                <li>Tick <span className="hl"><strong>“Share tab audio”</strong></span> — this part is required</li>
                <li>Watch captions roll in, then hit <strong>Stop &amp; Summarize</strong> when you&apos;re done</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── Active Session ── */}
        {view === 'active' && (
          <div className="view">
            <div style={{ textAlign: 'center', marginBottom: 30 }}>
              <span className="rec-pill" style={{ marginBottom: 18 }}>
                <span className="dot" /> Recording
              </span>
              <h2 className="h2" style={{ margin: '18px 0 8px' }}>{meetTitle || 'My Session'}</h2>
              <p style={{ color: 'var(--muted)', fontSize: 13.5 }}>
                Transcribing tab audio in real time{transcribing && <span style={{ color: 'var(--faint)' }}> · processing…</span>}
              </p>
            </div>

            <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
              <div className="transcript-head">
                <AudioLines size={14} color="var(--accent)" />
                <span className="section-label">Live Transcript</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--faint)' }}>{liveTranscripts.length} lines</span>
              </div>
              <div className="transcript-body" ref={transcriptRef}>
                {liveTranscripts.length === 0
                  ? <p className="muted-center">Listening… the first caption appears within ~{CHUNK_MS / 1000}s of someone speaking.</p>
                  : liveTranscripts.map((t, i) => (
                    <div key={i} className="t-line">
                      <span className="t-time">{new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="t-text">{t.text}</span>
                    </div>
                  ))
                }
              </div>
            </div>

            {error && <div className="alert alert-error" style={{ marginBottom: 12 }}>{error}</div>}

            <Btn onClick={handleStop} loading={loading} loadingText="Generating summary…" variant="danger" icon={<Square size={14} />}>
              Stop &amp; Summarize
            </Btn>
          </div>
        )}

        {/* ── Ask AI (semantic search) ── */}
        {view === 'ask' && (
          <div className="view">
            <h2 className="h2" style={{ marginBottom: 8 }}>Ask your history</h2>
            <p className="lead" style={{ fontSize: 14, marginBottom: 22 }}>
              Search across everything you&apos;ve captured. Ask in plain English — Earshot finds the relevant sessions and answers with citations.
            </p>

            <div className="search-row" style={{ marginBottom: 22 }}>
              <input
                className="input"
                placeholder="What did we decide about the launch date?"
                value={askQuery}
                onChange={e => setAskQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !askLoading && handleAsk()}
              />
              <button className="btn btn-primary" onClick={handleAsk} disabled={askLoading} style={{ flexShrink: 0 }}>
                {askLoading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
                Ask
              </button>
            </div>

            {askLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
                <Loader2 size={14} className="spin" /> Searching your sessions…
              </div>
            )}

            {askDone && !askLoading && (
              <div>
                <div className="card card-pad" style={{ marginBottom: 18 }}>
                  <div className="answer-head">
                    <Sparkles size={16} />
                    <span className="section-label" style={{ color: 'var(--accent)' }}>Answer</span>
                  </div>
                  <div className="md-content"><ReactMarkdown>{askAnswer}</ReactMarkdown></div>
                </div>

                {askMatches.length > 0 && (
                  <div>
                    <p className="section-label" style={{ marginBottom: 11 }}>Sources</p>
                    <div className="stack" style={{ gap: 9 }}>
                      {askMatches.map(m => (
                        <button key={m.sessionId} className="source" onClick={() => openSummary(m.sessionId)}>
                          {m.mode && <ModeBadge mode={m.mode} />}
                          <span style={{ flex: 1, fontSize: 13.5, color: 'var(--text)' }}>{m.title}</span>
                          <span className="score">{m.score}% match</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Library ── */}
        {view === 'summaries' && (
          <div className="view">
            <h2 className="h2" style={{ marginBottom: 24 }}>Library</h2>

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--muted)', fontSize: 13 }}>
                <Loader2 size={14} className="spin" /> Loading…
              </div>
            )}

            <div className="stack" style={{ gap: 10 }}>
              {summaries.map(item => (
                <SummaryCard
                  key={item.sessionId}
                  item={item}
                  onOpen={() => { setSelected(item); setView('detail'); }}
                  onDelete={async () => {
                    if (!window.confirm('Delete this summary?')) return;
                    await deleteSummary(item.sessionId);
                    setSummaries(prev => prev.filter(x => x.sessionId !== item.sessionId));
                  }}
                  formatDate={formatDate}
                />
              ))}
              {!loading && !summaries.length && (
                <div className="empty">
                  <FileText size={34} style={{ margin: '0 auto 14px', opacity: 0.3 }} />
                  <p style={{ fontSize: 13.5, marginBottom: 14 }}>Nothing here yet.</p>
                  <button className="link-btn" onClick={() => nav('home')}>Start your first session →</button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Detail ── */}
        {view === 'detail' && selected && (
          <div className="view">
            <button className="back" style={{ marginBottom: 24 }} onClick={() => nav('summaries')}>
              <ArrowLeft size={15} /> Back
            </button>

            <div style={{ marginBottom: 22 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                {selected.mode && <ModeBadge mode={selected.mode} />}
                <h2 className="h2">{selected.title}</h2>
              </div>
              <div className="meta">
                <span className="meta-item"><Clock size={12} />{formatDate(selected.startTime || selected.createdAt)}</span>
                {selected.durationMin > 0 && <span>{selected.durationMin} min</span>}
                {selected.wordCount > 0 && <span>{selected.wordCount.toLocaleString()} words captured</span>}
              </div>
            </div>

            <div className="row-between" style={{ justifyContent: 'flex-end', marginBottom: 12 }}>
              <button className="copy-btn" onClick={() => handleCopy(selected.summary)}>
                {copied ? <><Check size={13} color="var(--success)" /> Copied!</> : <><Copy size={13} /> Copy</>}
              </button>
            </div>

            <div className="card card-pad">
              <div className="md-content"><ReactMarkdown>{selected.summary}</ReactMarkdown></div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}

// ─── shared components ────────────────────────────────────────────────────────
function ModeBadge({ mode }) {
  const m = mode || 'meeting';
  return <span className={`badge badge-${m}`}>{m}</span>;
}

function Btn({ onClick, loading, loadingText, variant = 'primary', icon, children }) {
  return (
    <button className={`btn btn-${variant} btn-block`} onClick={onClick} disabled={loading}>
      {loading
        ? <><Loader2 size={15} className="spin" />{loadingText}</>
        : <>{icon}{children}</>}
    </button>
  );
}

function SummaryCard({ item, onOpen, onDelete, formatDate }) {
  return (
    <div className="s-card" onClick={onOpen}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          {item.mode && <ModeBadge mode={item.mode} />}
          <span className="s-title">{item.title}</span>
        </div>
        <div className="meta">
          <span className="meta-item"><Clock size={11} />{formatDate(item.createdAt || item.startTime)}</span>
          {item.durationMin > 0 && <span>{item.durationMin} min</span>}
          {item.wordCount > 0 && <span>{item.wordCount.toLocaleString()} words</span>}
        </div>
      </div>
      <button className="icon-btn" onClick={e => { e.stopPropagation(); onDelete(); }}>
        <Trash2 size={15} />
      </button>
    </div>
  );
}
