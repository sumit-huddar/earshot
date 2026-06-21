const Groq = require('groq-sdk');
const { toFile } = require('groq-sdk');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * Transcribe one audio chunk (webm/opus buffer from the browser) with Groq Whisper.
 * Returns the recognized text (may be empty for silence).
 */
async function transcribeChunk(buffer, filename = 'chunk.webm') {
  const file = await toFile(buffer, filename);
  const res = await groq.audio.transcriptions.create({
    file,
    model: 'whisper-large-v3-turbo',
    language: 'en',
    // Bias Whisper away from hallucinating on silence
    prompt: 'This is a segment of a meeting conversation.',
    temperature: 0,
  });
  return (res.text || '').trim();
}

// Whisper commonly hallucinates these on silent/near-silent chunks — drop them.
const HALLUCINATIONS = [
  'thank you', 'thanks for watching', 'thank you for watching',
  'please subscribe', 'you', '.', 'bye', 'bye.', 'thank you.',
];

function isNoise(text) {
  const t = text.toLowerCase().replace(/[^a-z ]/g, '').trim();
  if (t.length < 2) return true;
  return HALLUCINATIONS.includes(t);
}

module.exports = { transcribeChunk, isNoise };
