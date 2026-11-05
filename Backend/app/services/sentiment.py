"""Load the trained Naive Bayes pipeline and classify messages on demand."""

import logging
from functools import lru_cache
from pathlib import Path
import re

import joblib

from app.settings import settings

logger = logging.getLogger(__name__)


def clean_text(text: str) -> str:
    """Normalize URLs and mentions while preserving sentiment-bearing words."""
    text = re.sub(r"https?://\S+|www\.\S+", " url ", text, flags=re.IGNORECASE)
    text = re.sub(r"(?<!\w)@\w+", " user ", text)
    return re.sub(r"\s+", " ", text).strip().lower()


def _model_path() -> Path:
    root = Path(__file__).resolve().parents[3]
    if settings.sentiment_model_path:
        configured = Path(settings.sentiment_model_path).expanduser()
        return configured if configured.is_absolute() else root / configured
    return root / "ML" / "models" / "sentiment_naive_bayes.joblib"


@lru_cache(maxsize=1)
def _load_model():
    return joblib.load(_model_path())


def predict_sentiments(texts: list[str]) -> list[str | None]:
    """Predict all non-empty texts in a batch; missing artifacts never block messaging."""
    if not texts:
        return []
    try:
        model = _load_model()
        indices = [index for index, text in enumerate(texts) if text.strip()]
        labels: list[str | None] = [None] * len(texts)
        if indices:
            predictions = model.predict([texts[index] for index in indices])
            for index, prediction in zip(indices, predictions):
                label = str(prediction)
                labels[index] = label if label in {"positive", "neutral", "negative"} else None
        return labels
    except FileNotFoundError:
        logger.warning("Sentiment model artifact is missing at %s.", _model_path())
        return [None] * len(texts)
    except Exception:
        logger.exception("Sentiment model inference failed.")
        return [None] * len(texts)


def predict_sentiment(text: str) -> str | None:
    """Return the model's positive/neutral/negative prediction, if available."""
    return predict_sentiments([text])[0]
