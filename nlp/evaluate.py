"""Retrieval evaluation: Hit@1, Recall@k, and MRR over a hand-labeled query set.

The labels are authored against the known corpus (each query maps to the session that should be
retrieved). The queries are deliberately **paraphrased** — they avoid the transcript's exact wording
— to probe *vocabulary mismatch*, the regime where dense embeddings are expected to beat a sparse
TF-IDF baseline. This lets us quantify the two methods rather than eyeball them.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import pandas as pd

# (paraphrased query, [relevant sessionId(s)]) — authored against data/sessions.json.
# Intentionally low lexical overlap with the source transcripts.
LABELED_QUERIES: List[Tuple[str, List[str]]] = [
    ("the container that pops the most recently added item", ["real-stacks"]),
    ("teaching machines to recognize patterns by adjusting weights", ["real-neural-nets"]),
    ("what did the new-hire onboarding discussion decide", ["real-q3-roadmap"]),
    ("improving the online shopping purchase flow", ["sample-design-review"]),
    ("the team looks back at the last development cycle", ["sample-sprint-retro"]),
    ("reasoning about uncertainty and reversing conditional odds", ["sample-probability"]),
    ("the chemistry plants use to grow from light", ["sample-photosynthesis"]),
    ("debate on whether bigger models reach human-level intelligence", ["sample-podcast-agi"]),
    ("guarding your concentration from distractions", ["sample-podcast-productivity"]),
    ("a talk about throttling requests to a web service", ["sample-interview-backend"]),
    ("hiring conversation about leading a feature backlog", ["sample-interview-pm"]),
]


def recall_at_k(retrieved: List[str], relevant: List[str], k: int) -> float:
    """Fraction of relevant items found in the top-k (a.k.a. hit rate@k for single-relevant)."""
    if not relevant:
        return 0.0
    top = set(retrieved[:k])
    return sum(1 for r in relevant if r in top) / len(relevant)


def reciprocal_rank(retrieved: List[str], relevant: List[str]) -> float:
    for i, r in enumerate(retrieved, start=1):
        if r in relevant:
            return 1.0 / i
    return 0.0


def evaluate_index(index, k: int = 3, queries=LABELED_QUERIES) -> Tuple[Dict[str, float], pd.DataFrame]:
    """Run every labeled query through ``index`` and score the ranking.

    ``index`` must expose ``search(query, k)`` returning results whose ``meta`` carries a
    ``sessionId`` (see :class:`nlp.search.SemanticIndex`). Returns aggregate metrics and a
    per-query breakdown DataFrame.
    """
    rows = []
    for query, relevant in queries:
        results = index.search(query, k=k)
        retrieved_ids = [r.meta.get("sessionId") for r in results]
        rows.append(
            {
                "query": query,
                "expected": relevant[0],
                "top_hit": retrieved_ids[0] if retrieved_ids else None,
                "hit@1": bool(retrieved_ids[:1] == relevant[:1]),
                f"recall@{k}": recall_at_k(retrieved_ids, relevant, k),
                "RR": reciprocal_rank(retrieved_ids, relevant),
            }
        )
    df = pd.DataFrame(rows)
    metrics = {
        "queries": len(df),
        "hit@1": float(df["hit@1"].mean()),
        f"recall@{k}": float(df[f"recall@{k}"].mean()),
        "MRR": float(df["RR"].mean()),
    }
    return metrics, df
