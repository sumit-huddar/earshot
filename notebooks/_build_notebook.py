"""Builds notebooks/nlp_pipeline.ipynb from source cells using nbformat.

Run with the project venv:  .venv/bin/python notebooks/_build_notebook.py
Then execute:               .venv/bin/jupyter nbconvert --to notebook --execute --inplace notebooks/nlp_pipeline.ipynb
"""

import nbformat as nbf
from nbformat.v4 import new_notebook, new_markdown_cell, new_code_cell

nb = new_notebook()
cells = []


def md(text):
    cells.append(new_markdown_cell(text))


def code(src):
    cells.append(new_code_cell(src))


# ── Title ────────────────────────────────────────────────────────────────────
md(
    "# Earshot — NLP Pipeline for Spoken-Audio Transcripts\n"
    "\n"
    "**Semantic search, retrieval-augmented Q&A, and summarization over meeting / lecture / "
    "podcast / interview transcripts.**\n"
    "\n"
    "This notebook is the NLP core of the project. It builds, compares, and evaluates two retrieval "
    "approaches over a corpus of real captured + sample sessions:\n"
    "\n"
    "1. **TF-IDF** — a classic sparse bag-of-words baseline (scikit-learn).\n"
    "2. **Dense embeddings** — `all-MiniLM-L6-v2` sentence-transformers (the *same* model the live "
    "app runs on-device).\n"
    "\n"
    "It then adds embedding-based **extractive summarization**, **keyphrase extraction**, an "
    "**embedding-space visualization**, and a **RAG retrieval** walkthrough.\n"
    "\n"
    "> Pipeline: `transcript → preprocess → vectorize (TF-IDF / MiniLM) → cosine-similarity retrieval "
    "→ rank → summarize`."
)

md("## 0 · Setup")
code(
    "import sys, os\n"
    "sys.path.append(os.path.abspath('..'))  # make the `nlp` package importable\n"
    "\n"
    "import numpy as np\n"
    "import pandas as pd\n"
    "import matplotlib.pyplot as plt\n"
    "import seaborn as sns\n"
    "\n"
    "from nlp import data, preprocess, vectorizers, embeddings, search, summarize, keywords, evaluate\n"
    "\n"
    "sns.set_theme(style='whitegrid')\n"
    "preprocess.ensure_nltk()  # download tokenizer / stopwords / wordnet on first run\n"
    "pd.set_option('display.max_colwidth', 80)\n"
    "print('Setup complete.')"
)

# ── 1. Corpus ────────────────────────────────────────────────────────────────
md(
    "## 1 · Load & explore the corpus\n"
    "\n"
    "Each row is one session with its full transcript and structured summary. Sessions are tagged "
    "`captured` (real recordings) or `sample` (added for demonstration), and by `mode`."
)
code(
    "df = data.load_sessions()\n"
    "print(f'{len(df)} sessions')\n"
    "df[['title', 'mode', 'source', 'wordCount']]"
)
code(
    "fig, axes = plt.subplots(1, 2, figsize=(12, 4))\n"
    "df['mode'].value_counts().plot(kind='bar', ax=axes[0], color=sns.color_palette('viridis', df['mode'].nunique()))\n"
    "axes[0].set_title('Sessions per mode'); axes[0].set_ylabel('count'); axes[0].tick_params(axis='x', rotation=0)\n"
    "sns.barplot(data=df.sort_values('wordCount'), x='wordCount', y='title', ax=axes[1], palette='viridis')\n"
    "axes[1].set_title('Transcript length (words)'); axes[1].set_ylabel('')\n"
    "plt.tight_layout(); plt.show()"
)
code(
    "from wordcloud import WordCloud\n"
    "corpus_text = ' '.join(preprocess.preprocess(t) for t in df['transcript'])\n"
    "wc = WordCloud(width=900, height=350, background_color='white', colormap='viridis').generate(corpus_text)\n"
    "plt.figure(figsize=(12, 4.5)); plt.imshow(wc, interpolation='bilinear'); plt.axis('off')\n"
    "plt.title('Most frequent terms across all transcripts'); plt.show()"
)

# ── 2. Preprocessing ─────────────────────────────────────────────────────────
md(
    "## 2 · Text preprocessing\n"
    "\n"
    "Classic NLP cleanup for the TF-IDF path: lowercase → strip punctuation/markdown → tokenize → "
    "drop stopwords → lemmatize. (Dense embeddings deliberately use the *raw* text — they model "
    "context directly.)"
)
code(
    "sample = df.loc[df.title == 'Stacks and Queues', 'transcript'].iloc[0]\n"
    "print('RAW:\\n', sample[:240], '...\\n')\n"
    "print('TOKENS:\\n', preprocess.tokenize(sample)[:25], '...')"
)

# ── 3. TF-IDF ────────────────────────────────────────────────────────────────
md(
    "## 3 · TF-IDF baseline\n"
    "\n"
    "Turn each session into a sparse TF-IDF vector (unigrams + bigrams). The most heavily weighted "
    "terms per session double as interpretable keyphrases."
)
code(
    "tfidf_vec, tfidf_matrix = vectorizers.build_tfidf(df['document'].tolist())\n"
    "print('TF-IDF matrix shape (sessions x vocab):', tfidf_matrix.shape)\n"
    "for title in ['Stacks and Queues', 'Biology 101 — Photosynthesis']:\n"
    "    row = df.index[df.title == title][0]\n"
    "    terms = ', '.join(t for t, _ in vectorizers.top_terms(tfidf_vec, tfidf_matrix, row, n=6))\n"
    "    print(f'\\n{title}:\\n  {terms}')"
)

# ── 4. Dense embeddings ──────────────────────────────────────────────────────
md(
    "## 4 · Dense sentence embeddings\n"
    "\n"
    "Encode each session with `all-MiniLM-L6-v2` into a normalized 384-dim vector — the same model "
    "and dimensionality the production app uses on-device."
)
code(
    "doc_embeddings = embeddings.embed(df['document'].tolist())\n"
    "print('Embedding matrix shape (sessions x dims):', doc_embeddings.shape)\n"
    "print('L2 norm of first row (should be ~1.0):', np.linalg.norm(doc_embeddings[0]).round(4))"
)

# ── 5. Semantic search demo ──────────────────────────────────────────────────
md(
    "## 5 · Semantic search: TF-IDF vs. embeddings\n"
    "\n"
    "Both indexes expose the same `search(query, k)` API. Note how dense retrieval handles "
    "vocabulary mismatch — a query needn't share exact words with the transcript."
)
code(
    "metas = df[['sessionId', 'title', 'mode']].to_dict('records')\n"
    "docs = df['document'].tolist()\n"
    "idx_tfidf = search.SemanticIndex(docs, metas, method='tfidf')\n"
    "idx_dense = search.SemanticIndex(docs, metas, method='dense')\n"
    "\n"
    "def show(query, k=3):\n"
    "    print(f'QUERY: {query!r}\\n')\n"
    "    for name, idx in [('TF-IDF', idx_tfidf), ('Dense', idx_dense)]:\n"
    "        print(f'  [{name}]')\n"
    "        for r in idx.search(query, k=k):\n"
    "            print(f'    {r.score:.3f}  {r.meta[\"title\"]}')\n"
    "        print()\n"
    "\n"
    "show('how do plants turn sunlight into food')"
)
code("show('tips for staying focused and getting deep work done')")

# ── 6. Evaluation ────────────────────────────────────────────────────────────
md(
    "## 6 · Evaluation — TF-IDF vs. dense embeddings\n"
    "\n"
    "Against a hand-labeled set of **paraphrased** `query → expected session` pairs (queries that "
    "deliberately avoid the transcript's exact words), we measure **Hit@1**, **Recall@k**, and "
    "**MRR** (mean reciprocal rank). This is where dense embeddings should pull ahead: TF-IDF can "
    "only match shared terms, while embeddings match *meaning*."
)
code(
    "k = 3\n"
    "m_tfidf, by_q_tfidf = evaluate.evaluate_index(idx_tfidf, k=k)\n"
    "m_dense, by_q_dense = evaluate.evaluate_index(idx_dense, k=k)\n"
    "comparison = pd.DataFrame([m_tfidf, m_dense], index=['TF-IDF', 'Dense (MiniLM)'])\n"
    "comparison"
)
code(
    "ax = comparison[['hit@1', f'recall@{k}', 'MRR']].T.plot(kind='bar', figsize=(9, 4.5), colormap='viridis')\n"
    "ax.set_title('Retrieval quality on paraphrased queries: TF-IDF vs. dense embeddings'); ax.set_ylim(0, 1.05)\n"
    "ax.tick_params(axis='x', rotation=0); ax.legend(title='method'); plt.tight_layout(); plt.show()"
)
md(
    "Per-query view — the rows where TF-IDF's `top_hit` is wrong but dense is right are exactly the "
    "paraphrases with no shared vocabulary (e.g. *\"throttling requests\"* → the API rate-limiter "
    "interview). TF-IDF occasionally wins when the paraphrase still shares a rare keyword."
)
code(
    "merged = by_q_tfidf[['query', 'expected', 'top_hit', 'hit@1']].rename(columns={'top_hit': 'tfidf_hit', 'hit@1': 'tfidf@1'})\n"
    "merged['dense_hit'] = by_q_dense['top_hit']; merged['dense@1'] = by_q_dense['hit@1']\n"
    "merged[['query', 'expected', 'tfidf_hit', 'tfidf@1', 'dense_hit', 'dense@1']]"
)

# ── 7. Embedding viz ─────────────────────────────────────────────────────────
md(
    "## 7 · Visualizing the embedding space\n"
    "\n"
    "Projecting the 384-dim session vectors to 2-D with PCA shows that sessions of the same **mode** "
    "and topic cluster together — direct evidence the embeddings capture meaning."
)
code(
    "from sklearn.decomposition import PCA\n"
    "coords = PCA(n_components=2, random_state=0).fit_transform(doc_embeddings)\n"
    "viz = df.copy(); viz['x'], viz['y'] = coords[:, 0], coords[:, 1]\n"
    "plt.figure(figsize=(10, 6.5))\n"
    "sns.scatterplot(data=viz, x='x', y='y', hue='mode', s=160, palette='viridis')\n"
    "for _, r in viz.iterrows():\n"
    "    plt.annotate(r['title'][:22], (r['x'], r['y']), fontsize=8, xytext=(5, 4), textcoords='offset points')\n"
    "plt.title('Session embeddings (PCA → 2D), colored by mode'); plt.tight_layout(); plt.show()"
)
code(
    "# Finer-grained view: project transcript *passages* with t-SNE.\n"
    "passages = data.build_passages(df)\n"
    "p_emb = embeddings.embed(passages['passage'].tolist())\n"
    "from sklearn.manifold import TSNE\n"
    "perp = max(2, min(15, len(passages) - 1))\n"
    "p_coords = TSNE(n_components=2, perplexity=perp, init='pca', random_state=0).fit_transform(p_emb)\n"
    "passages = passages.assign(x=p_coords[:, 0], y=p_coords[:, 1])\n"
    "plt.figure(figsize=(10, 6.5))\n"
    "sns.scatterplot(data=passages, x='x', y='y', hue='mode', s=70, palette='viridis', alpha=0.85)\n"
    "plt.title(f'{len(passages)} transcript passages (t-SNE → 2D), colored by mode'); plt.tight_layout(); plt.show()"
)

# ── 8. Summarization ─────────────────────────────────────────────────────────
md(
    "## 8 · Extractive summarization (embedding TextRank)\n"
    "\n"
    "A fully-local summarizer: embed each sentence, build a cosine-similarity graph, and rank "
    "sentences by PageRank centrality. Complements the app's abstractive LLM summaries — no API key."
)
code(
    "row = df[df.title == 'Q3 Roadmap Sync'].iloc[0]\n"
    "print('EXTRACTIVE (TextRank over sentence embeddings):\\n')\n"
    "for s in summarize.textrank_summary(row['transcript'], num_sentences=3):\n"
    "    print(' •', s)"
)

# ── 9. Keyphrases ────────────────────────────────────────────────────────────
md("## 9 · Keyphrase extraction\n\nTop TF-IDF terms per session — a quick auto-tagging signal.")
code(
    "kw = keywords.extract_keywords(df['document'].tolist(), n=6)\n"
    "for title, terms in zip(df['title'], kw):\n"
    "    print(f'{title:42s} →  ' + ', '.join(t for t, _ in terms))"
)

# ── 10. RAG ──────────────────────────────────────────────────────────────────
md(
    "## 10 · Retrieval-augmented generation (RAG) walkthrough\n"
    "\n"
    "The retrieval half of the app's *Ask AI* feature. We chunk transcripts into passages, embed "
    "them, retrieve the passages most similar to a question, and assemble the **context** that would "
    "be handed to the LLM for a grounded, cited answer."
)
code(
    "passage_index = search.SemanticIndex(\n"
    "    passages['passage'].tolist(),\n"
    "    passages[['sessionId', 'title', 'mode', 'chunk_id']].to_dict('records'),\n"
    "    method='dense',\n"
    ")\n"
    "question = 'what algorithm did the candidate suggest for rate limiting?'\n"
    "print(f'QUESTION: {question}\\n\\nRetrieved context:\\n')\n"
    "for r in passage_index.search(question, k=3):\n"
    "    print(f'[{r.score:.3f}] from \"{r.meta[\"title\"]}\":')\n"
    "    print('   ', r.text[:220], '...\\n')"
)

md(
    "## Summary\n"
    "\n"
    "- Built an end-to-end NLP retrieval pipeline over spoken-audio transcripts and compared a "
    "**TF-IDF** baseline against **dense MiniLM embeddings**, quantified with Hit@1 / P@k / MRR.\n"
    "- Dense embeddings handle vocabulary mismatch (paraphrased queries) where TF-IDF relies on exact "
    "term overlap.\n"
    "- Added embedding-based **extractive summarization**, **keyphrase extraction**, embedding-space "
    "**visualization**, and a **RAG** retrieval walkthrough.\n"
    "- The same `all-MiniLM-L6-v2` model and cosine-similarity retrieval power the interactive demo "
    "app in `app/`."
)

nb.cells = cells
nb.metadata = {
    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
    "language_info": {"name": "python"},
}

with open("notebooks/nlp_pipeline.ipynb", "w", encoding="utf-8") as f:
    nbf.write(nb, f)
print(f"Wrote notebooks/nlp_pipeline.ipynb with {len(cells)} cells")
