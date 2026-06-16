import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  Mic, Square, Clock, FileText, Trash2,
  Copy, Check, ArrowLeft, Loader2, MonitorSpeaker,
  Users, GraduationCap, Podcast, MessageSquare, Search, Sparkles,
} from 'lucide-react';
import { startSession, sendAudioChunk, stopSession, getSummaries, getSummary, deleteSummary, searchHistory } from './api';

// ─── design tokens ──────────────────────────────────────────────────────────
const C = {
  pageBg:    '#030712',
  surface:   '#0d1117',
  surfaceAlt:'#161b22',
  border:    '#21262d',
  borderFocus:'#388bfd',
  text:      '#e6edf3',
  muted:     '#7d8590',
  faint:     '#484f58',
  blue:      '#1f6feb',
  blueHover: '#388bfd',
  green:     '#3fb950',
  greenBg:   '#0f2a1b',
  greenBorder:'#1a4731',
  red:       '#f85149',
};

const s = {
  input: {
    width: '100%',
    background: C.pageBg,
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    padding: '10px 14px',
    color: C.text,
    fontSize: 14,
    outline: 'none',
    transition: 'border-color .15s',
    boxSizing: 'border-box',
  },
};

const CHUNK_MS = 15000; // length of each audio slice sent for transcription

const MODES = [
  { key: 'meeting',   label: 'Meeting',   icon: Users,         hint: 'Decisions & action items' },
  { key: 'lecture',   label: 'Lecture',   icon: GraduationCap, hint: 'Study notes & key concepts' },
  { key: 'podcast',   label: 'Podcast',   icon: Podcast,       hint: 'Takeaways & references' },
  { key: 'interview', label: 'Interview', icon: MessageSquare, hint: 'Q&A & assessment' },
];
// ────────────────────────────────────────────────────────────────────────────

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
      setError('Screen share was cancelled. Click Start and choose your Meet tab.');
      return;
    }

    const audioTracks = display.getAudioTracks();
    if (audioTracks.length === 0) {
      display.getTracks().forEach(t => t.stop());
      setError('No audio was shared. When picking the tab, you must tick the "Share tab audio" checkbox.');
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

  const nav = (v) => { setView(v); setError(''); if (v === 'summaries') loadSummaries(); };

  const formatDate = (d) =>
    d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div style={{ minHeight: '100vh', background: C.pageBg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Header ── */}
      <header style={{ borderBottom: `1px solid ${C.border}`, padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, position: 'sticky', top: 0, background: C.pageBg, zIndex: 10 }}>
        <button onClick={() => nav('home')} style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', color: C.text, cursor: 'pointer', fontSize: 15, fontWeight: 600 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: C.blue, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Mic size={15} color="#fff" />
          </div>
          Earshot
        </button>
        <nav style={{ display: 'flex', gap: 4 }}>
          {[['home','New Session'], ['ask','Ask AI'], ['summaries','Summaries']].map(([v, label]) => (
            <button key={v} onClick={() => nav(v)} style={{ background: (view === v || (v === 'summaries' && view === 'detail')) ? C.surfaceAlt : 'none', border: `1px solid ${(view === v || (v === 'summaries' && view === 'detail')) ? C.border : 'transparent'}`, borderRadius: 6, padding: '5px 12px', color: (view === v || (v === 'summaries' && view === 'detail')) ? C.text : C.muted, cursor: 'pointer', fontSize: 13 }}>
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 640, margin: '0 auto', padding: '48px 24px' }}>

        {/* ── Home ── */}
        {view === 'home' && (
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 700, marginBottom: 8, letterSpacing: '-0.02em' }}>Your second brain for anything you hear</h1>
            <p style={{ color: C.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
              Share any tab&apos;s audio — a meeting, lecture, podcast, or interview — and Earshot transcribes it live, writes a structured summary, and makes every word searchable forever. Works with Google Meet, Zoom web, YouTube, or anything that plays sound.
            </p>

            {error && <Alert type="error" msg={error} />}
            <div style={{ height: error ? 16 : 0 }} />

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Field label="What are you capturing?">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {MODES.map(m => {
                    const Icon = m.icon;
                    const active = mode === m.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setMode(m.key)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left',
                          background: active ? '#10243f' : C.pageBg,
                          border: `1px solid ${active ? C.blue : C.border}`,
                          borderRadius: 8, padding: '10px 12px', cursor: 'pointer', transition: 'all .15s',
                        }}
                      >
                        <Icon size={16} color={active ? C.blueHover : C.muted} style={{ flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: active ? C.text : '#c9d1d9' }}>{m.label}</div>
                          <div style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.hint}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Title">
                <input
                  style={s.input}
                  placeholder="Weekly Standup"
                  value={meetTitle}
                  onChange={e => setMeetTitle(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !loading && handleStart()}
                  onFocus={e => e.target.style.borderColor = C.borderFocus}
                  onBlur={e => e.target.style.borderColor = C.border}
                />
              </Field>
              <Btn onClick={handleStart} loading={loading} loadingText="Starting..." icon={<MonitorSpeaker size={15} />}>
                Start Capture
              </Btn>
            </div>

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '14px 16px', marginTop: 16, fontSize: 12.5, color: C.muted, lineHeight: 1.7 }}>
              <strong style={{ color: C.text }}>How it works:</strong>
              <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                <li>Join your meeting normally in another tab</li>
                <li>Click <strong style={{ color: C.text }}>Start Capture</strong> → in the picker, choose that tab</li>
                <li><strong style={{ color: C.green }}>Tick &ldquo;Share tab audio&rdquo;</strong> (bottom-left of the picker) — this is required</li>
                <li>Captions stream in live. Click Stop &amp; Summarize when finished.</li>
              </ol>
            </div>
          </div>
        )}

        {/* ── Active Session ── */}
        {view === 'active' && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: C.greenBg, border: `1px solid ${C.greenBorder}`, borderRadius: 20, padding: '5px 12px', fontSize: 12, color: C.green, marginBottom: 20 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: C.green, animation: 'pulse 2s infinite' }} />
                Recording
              </div>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 6 }}>
                {meetTitle || 'My Meeting'}
              </h2>
              <p style={{ color: C.muted, fontSize: 13 }}>
                Transcribing tab audio in real time {transcribing && <span style={{ color: C.faint }}>· processing…</span>}
              </p>
            </div>

            {/* Live transcript */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
              <div style={{ padding: '10px 16px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <FileText size={13} color={C.muted} />
                <span style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Live Transcript</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: C.faint }}>{liveTranscripts.length} lines</span>
              </div>
              <div ref={transcriptRef} style={{ height: 260, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {liveTranscripts.length === 0
                  ? <p style={{ color: C.faint, fontSize: 13, textAlign: 'center', paddingTop: 60, lineHeight: 1.6 }}>Listening… the first caption appears within ~{CHUNK_MS / 1000}s of someone speaking.</p>
                  : liveTranscripts.map((t, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                      <span style={{ color: C.faint, fontSize: 11, paddingTop: 2, flexShrink: 0 }}>
                        {new Date(t.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{ color: '#c9d1d9', lineHeight: 1.6 }}>{t.text}</span>
                    </div>
                  ))
                }
              </div>
            </div>

            {error && <><Alert type="error" msg={error} /><div style={{ height: 12 }} /></>}

            <Btn onClick={handleStop} loading={loading} loadingText="Generating summary..." color="red" icon={<Square size={13} />}>
              Stop &amp; Summarize
            </Btn>
          </div>
        )}

        {/* ── Ask AI (semantic search) ── */}
        {view === 'ask' && (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 6 }}>Ask your history</h2>
            <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.6, marginBottom: 20 }}>
              Search across everything you&apos;ve ever captured. Ask in plain English — it finds the relevant sessions and answers with citations.
            </p>

            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <input
                style={{ ...s.input, flex: 1 }}
                placeholder="e.g. What did we decide about the launch date?"
                value={askQuery}
                onChange={e => setAskQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !askLoading && handleAsk()}
                onFocus={e => e.target.style.borderColor = C.borderFocus}
                onBlur={e => e.target.style.borderColor = C.border}
              />
              <button
                onClick={handleAsk}
                disabled={askLoading}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.blue, border: 'none', borderRadius: 8, padding: '0 16px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: askLoading ? 'not-allowed' : 'pointer', opacity: askLoading ? 0.6 : 1, whiteSpace: 'nowrap' }}
              >
                {askLoading ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={15} />}
                Ask
              </button>
            </div>

            {askLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13 }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Searching your sessions...
              </div>
            )}

            {askDone && !askLoading && (
              <div>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24, marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: C.blueHover }}>
                    <Sparkles size={15} />
                    <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Answer</span>
                  </div>
                  <div className="md-content">
                    <ReactMarkdown>{askAnswer}</ReactMarkdown>
                  </div>
                </div>

                {askMatches.length > 0 && (
                  <div>
                    <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                      Sources
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {askMatches.map(m => (
                        <button
                          key={m.sessionId}
                          onClick={async () => {
                            try {
                              const { data } = await getSummary(m.sessionId);
                              setSelected(data); setView('detail');
                            } catch {}
                          }}
                          style={{ display: 'flex', alignItems: 'center', gap: 10, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 14px', cursor: 'pointer', textAlign: 'left' }}
                        >
                          <FileText size={14} color={C.muted} style={{ flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 13, color: C.text }}>{m.title}</span>
                          <span style={{ fontSize: 11, color: C.faint }}>{m.score}% match</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Summaries List ── */}
        {view === 'summaries' && (
          <div>
            <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 24 }}>Past Summaries</h2>

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, fontSize: 13 }}>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Loading...
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                <div style={{ textAlign: 'center', padding: '64px 0', color: C.faint }}>
                  <FileText size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                  <p style={{ fontSize: 13, marginBottom: 12 }}>No summaries yet.</p>
                  <button onClick={() => nav('home')} style={{ background: 'none', border: 'none', color: C.blue, cursor: 'pointer', fontSize: 13 }}>
                    Start a session →
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Detail ── */}
        {view === 'detail' && selected && (
          <div>
            <button onClick={() => nav('summaries')} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 13, marginBottom: 24 }}>
              <ArrowLeft size={14} /> Back
            </button>

            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em', marginBottom: 10 }}>{selected.title}</h2>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, fontSize: 12, color: C.muted }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}><Clock size={12} />{formatDate(selected.startTime || selected.createdAt)}</span>
                {selected.durationMin > 0 && <span>{selected.durationMin} min</span>}
                {selected.wordCount > 0 && <span>{selected.wordCount.toLocaleString()} words captured</span>}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button
                onClick={() => handleCopy(selected.summary)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 12px', color: C.muted, cursor: 'pointer', fontSize: 12 }}
              >
                {copied ? <><Check size={12} color={C.green} /> Copied!</> : <><Copy size={12} /> Copy</>}
              </button>
            </div>

            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24 }}>
              <div className="md-content">
                <ReactMarkdown>{selected.summary}</ReactMarkdown>
              </div>
            </div>
          </div>
        )}

      </main>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin  { to{transform:rotate(360deg)} }
        input::placeholder { color: ${C.faint}; }
      `}</style>
    </div>
  );
}

// ─── tiny shared components ──────────────────────────────────────────────────
function Field({ label, required, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#7d8590', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label} {required && <span style={{ color: '#388bfd', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>*</span>}
      </label>
      {children}
    </div>
  );
}

function Btn({ onClick, loading, loadingText, color = 'blue', icon, children }) {
  const bg    = color === 'red' ? '#b91c1c' : '#1f6feb';
  const bgHov = color === 'red' ? '#dc2626' : '#388bfd';
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, width: '100%', background: hov && !loading ? bgHov : bg, border: 'none', borderRadius: 8, padding: '11px 16px', color: '#fff', fontSize: 14, fontWeight: 600, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1, transition: 'background .15s' }}
    >
      {loading
        ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />{loadingText}</>
        : <>{icon}{children}</>}
    </button>
  );
}

function Alert({ type, msg }) {
  const isErr = type === 'error';
  return (
    <div style={{ background: isErr ? '#2d0f0e' : '#0f2a1b', border: `1px solid ${isErr ? '#6e2020' : '#1a4731'}`, borderRadius: 8, padding: '10px 14px', color: isErr ? '#f85149' : '#3fb950', fontSize: 13, lineHeight: 1.5 }}>
      {msg}
    </div>
  );
}

function SummaryCard({ item, onOpen, onDelete, formatDate }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ background: hov ? '#161b22' : '#0d1117', border: `1px solid ${hov ? '#30363d' : '#21262d'}`, borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'all .15s' }}
      onClick={onOpen}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontWeight: 500, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</p>
        <div style={{ display: 'flex', gap: 14, marginTop: 5, fontSize: 12, color: '#7d8590', flexWrap: 'wrap' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={11} />{formatDate(item.createdAt || item.startTime)}</span>
          {item.durationMin > 0 && <span>{item.durationMin} min</span>}
          {item.wordCount > 0 && <span>{item.wordCount.toLocaleString()} words</span>}
        </div>
      </div>
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', padding: 4, borderRadius: 6, display: 'flex', transition: 'color .15s' }}
        onMouseEnter={e => e.currentTarget.style.color = '#f85149'}
        onMouseLeave={e => e.currentTarget.style.color = '#484f58'}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}
