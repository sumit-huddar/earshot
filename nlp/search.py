"""Cosine-similarity ranking and a unified semantic-search interface.

`SemanticIndex` indexes a corpus with either the TF-IDF baseline or dense embeddings and
exposes the same `search(query, k)` API for both — making a head-to-head comparison trivial.
This mirrors the app's retrieval step (`rank()` in `embeddings.js` + the `/api/search`
endpoint in `index.js`), generalized to swap the vectorizer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Literal

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

from . import embeddings as emb
from .preprocess import preprocess
from .vectorizers import build_tfidf

Method = Literal["tfidf", "dense"]


@dataclass
class SearchResult:
    rank: int
    index: int          # row in the indexed corpus
    score: float
    text: str
    meta: dict


class SemanticIndex:
    """Index a list of documents and rank them against a query by cosine similarity."""

    def __init__(self, texts: List[str], metas: List[dict] | None = None, method: Method = "dense"):
        self.texts = list(texts)
        self.metas = list(metas) if metas is not None else [{} for _ in texts]
        self.method = method

        if method == "tfidf":
            self.vectorizer, self.matrix = build_tfidf(self.texts)
        elif method == "dense":
            self.vectorizer = None
            self.matrix = emb.embed(self.texts)
        else:
            raise ValueError(f"Unknown method: {method!r}")

    def _embed_query(self, query: str) -> np.ndarray:
        if self.method == "tfidf":
            return self.vectorizer.transform([preprocess(query)])
        return emb.embed(query)

    def search(self, query: str, k: int = 4, min_score: float = 0.0) -> List[SearchResult]:
        """Return the top-k most similar documents, highest score first."""
        qvec = self._embed_query(query)
        scores = cosine_similarity(qvec, self.matrix).ravel()
        order = scores.argsort()[::-1][:k]
        results = []
        for rank, idx in enumerate(order, start=1):
            score = float(scores[idx])
            if score < min_score:
                continue
            results.append(
                SearchResult(rank=rank, index=int(idx), score=score, text=self.texts[idx], meta=self.metas[idx])
            )
        return results
