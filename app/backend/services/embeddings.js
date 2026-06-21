// Local, on-device text embeddings (no API key, no quota) via transformers.js.
// Model: all-MiniLM-L6-v2 (384-dim). Downloaded & cached on first use.

let extractorPromise = null;

async function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      console.log('[Embeddings] Loading local model (first run downloads ~25MB)...');
      const ex = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      console.log('[Embeddings] Model ready');
      return ex;
    })();
  }
  return extractorPromise;
}

/** Embed a string → normalized 384-dim array. */
async function embed(text) {
  const extractor = await getExtractor();
  const clean = (text || '').slice(0, 8000); // model truncates anyway; cap for speed
  const out = await extractor(clean || ' ', { pooling: 'mean', normalize: true });
  return Array.from(out.data);
}

/** Cosine similarity of two equal-length vectors (already normalized → dot product). */
function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/**
 * Rank records (each having a .embedding) against a query vector.
 * Returns the top-k records with an added _score, highest first.
 */
function rank(queryVec, records, k = 4) {
  return records
    .filter(r => Array.isArray(r.embedding) && r.embedding.length)
    .map(r => ({ ...r, _score: cosine(queryVec, r.embedding) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, k);
}

module.exports = { embed, cosine, rank };
