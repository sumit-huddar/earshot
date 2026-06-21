"""Load the session corpus and chunk transcripts into retrieval passages."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List

import pandas as pd

# data/sessions.json lives one directory up from this package.
DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "sessions.json"


def load_sessions(path: Path | str = DATA_PATH) -> pd.DataFrame:
    """Load sessions into a DataFrame.

    Each row is one captured/sample session with its full transcript and summary.
    A ``document`` column (title + summary + transcript) is added — this is the text
    that gets indexed for session-level retrieval, mirroring how the live app embeds
    ``title + summary + transcript`` together in ``backend/services``.
    """
    records = json.loads(Path(path).read_text(encoding="utf-8"))
    df = pd.DataFrame(records)
    df["mode"] = df["mode"].fillna("other")
    df["document"] = (
        df["title"].fillna("") + "\n\n" + df["summary"].fillna("") + "\n\n" + df["transcript"].fillna("")
    ).str.strip()
    return df


def split_sentences(text: str) -> List[str]:
    """Lightweight sentence splitter (avoids a heavyweight dependency)."""
    import re

    parts = re.split(r"(?<=[.!?])\s+", (text or "").strip())
    return [p.strip() for p in parts if p.strip()]


def chunk_text(text: str, max_words: int = 60, overlap: int = 15) -> List[str]:
    """Split text into overlapping word-windows — the standard RAG chunking step.

    Sentence-aware: sentences are packed into a chunk until ``max_words`` is reached,
    then a new chunk starts carrying ``overlap`` words of context from the previous one.
    """
    sentences = split_sentences(text)
    chunks: List[str] = []
    current: List[str] = []
    count = 0
    for sent in sentences:
        words = sent.split()
        if count + len(words) > max_words and current:
            chunks.append(" ".join(current))
            carry = current[-overlap:] if overlap else []
            current = list(carry)
            count = len(carry)
        current.extend(words)
        count += len(words)
    if current:
        chunks.append(" ".join(current))
    return chunks


def build_passages(df: pd.DataFrame, max_words: int = 60, overlap: int = 15) -> pd.DataFrame:
    """Explode each session's transcript into overlapping passages for fine-grained RAG.

    Returns a long DataFrame with one row per passage, carrying the parent session's
    ``sessionId``, ``title`` and ``mode`` so retrieved passages can be traced back.
    """
    rows = []
    for _, s in df.iterrows():
        for i, passage in enumerate(chunk_text(s["transcript"], max_words, overlap)):
            rows.append(
                {
                    "sessionId": s["sessionId"],
                    "title": s["title"],
                    "mode": s["mode"],
                    "chunk_id": f"{s['sessionId']}::{i}",
                    "passage": passage,
                }
            )
    return pd.DataFrame(rows)
