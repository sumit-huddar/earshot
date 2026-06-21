"""Classic NLP text preprocessing: clean, tokenize, remove stopwords, lemmatize.

Used to prepare text for the TF-IDF baseline and for keyphrase extraction. Dense
sentence-transformer embeddings deliberately skip most of this — they perform best on
raw, natural text — which is itself a useful contrast to demonstrate in the notebook.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import List

import nltk
from nltk.corpus import stopwords
from nltk.stem import WordNetLemmatizer
from nltk.tokenize import word_tokenize


def ensure_nltk() -> None:
    """Download the NLTK data files this module needs (idempotent)."""
    for pkg, path in [
        ("punkt", "tokenizers/punkt"),
        ("punkt_tab", "tokenizers/punkt_tab"),
        ("stopwords", "corpora/stopwords"),
        ("wordnet", "corpora/wordnet"),
        ("omw-1.4", "corpora/omw-1.4"),
    ]:
        try:
            nltk.data.find(path)
        except LookupError:
            nltk.download(pkg, quiet=True)


@lru_cache(maxsize=1)
def _lemmatizer() -> WordNetLemmatizer:
    ensure_nltk()
    return WordNetLemmatizer()


@lru_cache(maxsize=1)
def _stopwords() -> frozenset:
    ensure_nltk()
    return frozenset(stopwords.words("english"))


def clean(text: str) -> str:
    """Lowercase, strip URLs/markdown/punctuation, collapse whitespace."""
    text = (text or "").lower()
    text = re.sub(r"http\S+", " ", text)
    text = re.sub(r"[#*_>`|\-]", " ", text)        # markdown artifacts from summaries
    text = re.sub(r"[^a-z0-9\s]", " ", text)        # keep alphanumerics
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def tokenize(text: str, remove_stops: bool = True, lemmatize: bool = True) -> List[str]:
    """Clean → tokenize → (optionally) drop stopwords and short tokens → lemmatize."""
    ensure_nltk()
    tokens = word_tokenize(clean(text))
    stops = _stopwords() if remove_stops else frozenset()
    lem = _lemmatizer()
    out = []
    for tok in tokens:
        if len(tok) < 2 or tok in stops:
            continue
        out.append(lem.lemmatize(tok) if lemmatize else tok)
    return out


def preprocess(text: str, **kwargs) -> str:
    """Return the preprocessed text as a single space-joined string (for vectorizers)."""
    return " ".join(tokenize(text, **kwargs))
