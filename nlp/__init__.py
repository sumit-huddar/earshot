"""
Earshot NLP — semantic search, retrieval, and summarization over spoken-audio transcripts.

This package is the NLP core of the project. It re-implements (and extends) the retrieval
pipeline that powers the live demo app: embed text, rank by cosine similarity, retrieve the
most relevant sessions. On top of that core it adds a classic TF-IDF baseline, extractive
summarization, keyphrase extraction, and a small retrieval-evaluation harness.

Modules
-------
data         load the session corpus and chunk transcripts into passages
preprocess   text cleaning, tokenization, stopword removal, lemmatization
vectorizers  TF-IDF vectorization (classic sparse baseline)
embeddings   dense sentence embeddings via all-MiniLM-L6-v2 (same model as the app)
search       cosine-similarity ranking + a unified semantic_search() over both methods
summarize    embedding-based TextRank extractive summarization
keywords     per-session TF-IDF keyphrase extraction
evaluate     precision@k / MRR over a small hand-labeled query set
"""

from . import data, preprocess, vectorizers, embeddings, search, summarize, keywords, evaluate

__all__ = [
    "data",
    "preprocess",
    "vectorizers",
    "embeddings",
    "search",
    "summarize",
    "keywords",
    "evaluate",
]
