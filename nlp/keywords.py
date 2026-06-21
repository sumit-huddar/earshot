"""Per-session keyphrase extraction using TF-IDF weights.

Surfaces the terms that most distinguish each session from the rest of the corpus —
useful for auto-tagging sessions and for a quick, interpretable view of what each is about.
"""

from __future__ import annotations

from typing import List, Tuple

from .vectorizers import build_tfidf, top_terms


def extract_keywords(documents: List[str], n: int = 8) -> List[List[Tuple[str, float]]]:
    """Return the top-n TF-IDF keyphrases for every document in ``documents``."""
    vectorizer, matrix = build_tfidf(documents)
    return [top_terms(vectorizer, matrix, row, n=n) for row in range(matrix.shape[0])]
