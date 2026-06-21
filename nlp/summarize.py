"""Extractive summarization via embedding-based TextRank.

A graph-based, fully-local summarizer that complements the app's abstractive LLM summaries:
embed each sentence, connect sentences by cosine similarity, run PageRank, and return the
most central sentences. No API call, no key — pure NLP.
"""

from __future__ import annotations

from typing import List

import networkx as nx
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from . import embeddings as emb
from .data import split_sentences


def textrank_summary(text: str, num_sentences: int = 3, threshold: float = 0.2) -> List[str]:
    """Return the top sentences of ``text`` ranked by graph centrality (in original order).

    Edges below ``threshold`` cosine similarity are dropped so only genuinely related
    sentences reinforce each other.
    """
    sentences = split_sentences(text)
    if len(sentences) <= num_sentences:
        return sentences

    vecs = emb.embed(sentences)
    sim = cosine_similarity(vecs)
    np.fill_diagonal(sim, 0.0)
    sim[sim < threshold] = 0.0

    graph = nx.from_numpy_array(sim)
    scores = nx.pagerank(graph, max_iter=200)

    ranked = sorted(range(len(sentences)), key=lambda i: scores[i], reverse=True)
    chosen = sorted(ranked[:num_sentences])          # restore reading order
    return [sentences[i] for i in chosen]


def summarize(text: str, num_sentences: int = 3) -> str:
    """Convenience wrapper that joins the extracted sentences into a paragraph."""
    return " ".join(textrank_summary(text, num_sentences=num_sentences))
