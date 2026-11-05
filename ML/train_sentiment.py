"""Train and evaluate TeamFlow's TF-IDF + Multinomial Naive Bayes model."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.naive_bayes import MultinomialNB
from sklearn.pipeline import Pipeline

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "Backend"))
from app.services.sentiment import clean_text

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data" / "tweeteval-sentiment"
MODEL_PATH = ROOT / "models" / "sentiment_naive_bayes.joblib"
METRICS_PATH = ROOT / "models" / "metrics.json"
LABELS = {"0": "negative", "1": "neutral", "2": "positive"}
CLASS_ORDER = ["negative", "neutral", "positive"]


def load_split(name: str) -> tuple[list[str], list[str]]:
    texts = (DATA / f"{name}_text.txt").read_text(encoding="utf-8", errors="replace").splitlines()
    raw_labels = (DATA / f"{name}_labels.txt").read_text(encoding="utf-8").splitlines()
    if len(texts) != len(raw_labels):
        raise ValueError(f"{name} split has {len(texts)} messages and {len(raw_labels)} labels.")
    return texts, [LABELS[label] for label in raw_labels]


def build_pipeline() -> Pipeline:
    return Pipeline([
        ("tfidf", TfidfVectorizer(
            preprocessor=clean_text,
            token_pattern=r"(?u)\b\w+\b",
            ngram_range=(1, 2),
            min_df=2,
            sublinear_tf=True,
        )),
        ("classifier", MultinomialNB(alpha=0.2)),
    ])


def evaluate(model: Pipeline, texts: list[str], labels: list[str]) -> dict:
    predictions = model.predict(texts)
    return {
        "accuracy": accuracy_score(labels, predictions),
        "classification_report": classification_report(
            labels, predictions, labels=CLASS_ORDER, output_dict=True, zero_division=0
        ),
        "confusion_matrix": confusion_matrix(labels, predictions, labels=CLASS_ORDER).tolist(),
    }


def main() -> None:
    train_text, train_labels = load_split("train")
    val_text, val_labels = load_split("val")
    test_text, test_labels = load_split("test")

    validation_model = build_pipeline().fit(train_text, train_labels)
    validation_metrics = evaluate(validation_model, val_text, val_labels)

    final_model = build_pipeline().fit(train_text + val_text, train_labels + val_labels)
    test_metrics = evaluate(final_model, test_text, test_labels)
    MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(final_model, MODEL_PATH, compress=3)
    metrics = {
        "algorithm": "Multinomial Naive Bayes",
        "features": "TF-IDF word unigrams and bigrams",
        "training_examples": len(train_text) + len(val_text),
        "test_examples": len(test_text),
        "classes": CLASS_ORDER,
        "validation": validation_metrics,
        "test": test_metrics,
    }
    METRICS_PATH.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")
    print(f"Validation accuracy: {validation_metrics['accuracy']:.4f}")
    print(f"Held-out test accuracy: {test_metrics['accuracy']:.4f}")
    print(classification_report(test_labels, final_model.predict(test_text), labels=CLASS_ORDER, zero_division=0))
    print(f"Model saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()
