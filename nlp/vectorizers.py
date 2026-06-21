"""TF-IDF vectorization — the classic sparse baseline for retrieval.

This is the same technique behind a content-based recommender: turn each document into a
sparse term-frequency vector weighted by inverse document frequency, then compare with
cosine similarity. It's the baseline the dense embeddings are measured against.
"""

from __future__ import annotations

from typing import List, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

from .preprocess import preprocess


def build_tfidf(documents: List[str], **kwargs) -> Tuple[TfidfVectorizer, "np.ndarray"]:
    """Fit a TF-IDF vectorizer on preprocessed documents.

    Uses unigrams + bigrams by default and lemmatized, stopword-free input so the
    vocabulary stays meaningful on a small corpus. Returns (vectorizer, doc_matrix).
    """
    params = dict(ngram_range=(1, 2), min_df=1, sublinear_tf=True)
    params.update(kwargs)
    vectorizer = TfidfVectorizer(**params)
    cleaned = [preprocess(d) for d in documents]
    matrix = vectorizer.fit_transform(cleaned)
    return vectorizer, matrix


def top_terms(vectorizer: TfidfVectorizer, matrix, row: int, n: int = 10) -> List[Tuple[str, float]]:
    """Return the top-n highest-weighted TF-IDF terms for one document row."""
    feature_names = np.array(vectorizer.get_feature_names_out())
    weights = matrix[row].toarray().ravel()
    top_idx = weights.argsort()[::-1][:n]
    return [(feature_names[i], float(weights[i])) for i in top_idx if weights[i] > 0]
