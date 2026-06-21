"""Dense sentence embeddings via all-MiniLM-L6-v2.

This is the Python twin of ``app/backend/services/embeddings.js``: it loads the *same*
384-dimensional model (``all-MiniLM-L6-v2``) and L2-normalizes the output, so cosine
similarity reduces to a dot product — exactly as the live app does it on-device.
"""

from __future__ import annotations

from functools import lru_cache
from typing import List, Sequence

import numpy as np

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBED_DIM = 384


@lru_cache(maxsize=1)
def get_model():
    """Load (and cache) the SentenceTransformer model. Downloads ~90MB on first use."""
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_NAME)


def embed(texts: Sequence[str] | str, batch_size: int = 32) -> np.ndarray:
    """Encode text(s) into normalized 384-dim vectors.

    Accepts a single string or a list; always returns a 2-D array of shape
    (n_texts, 384) with unit-norm rows.
    """
    if isinstance(texts, str):
        texts = [texts]
    model = get_model()
    vecs = model.encode(
        list(texts),
        batch_size=batch_size,
        normalize_embeddings=True,
        show_progress_bar=False,
    )
    return np.asarray(vecs, dtype=np.float32)
