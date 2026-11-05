# TeamFlow sentiment model

The message classifier is a scikit-learn `TfidfVectorizer` + `MultinomialNB` pipeline with `negative`, `neutral`, and `positive` outputs. It is trained and evaluated by `train_sentiment.py`; the backend loads the saved pipeline for message inference.

## Dataset

`data/tweeteval-sentiment/` contains TweetEval's official train, validation, and test short-text splits and label mapping. The upstream project describes sentiment labels as negative, neutral, and positive and notes that restrictions may apply to the source datasets and Twitter terms. See the [TweetEval repository](https://github.com/cardiffnlp/tweeteval) and the original [SemEval-2017 sentiment task](https://aclanthology.org/S17-2088/). Review source terms before redistributing beyond this project submission.

TweetEval contains tweets rather than workplace messages. It is a reproducible starting dataset, but its accuracy may not represent internal chat performance; collect appropriately consented and anonymized workplace examples before treating these labels as production-grade.

## Train and evaluate

From the repository root:

```bash
uv run --project Backend python ML/train_sentiment.py
```

The script normalizes URLs and mentions, trains on the training split, reports validation accuracy, then refits on train + validation and reports held-out test accuracy, per-class precision/recall/F1, and a confusion matrix. It writes `models/sentiment_naive_bayes.joblib` and `models/metrics.json`.

`sentiment_training.ipynb` presents the same preprocessing, model fitting, and evaluation steps interactively. The serialized model is included in the repository so the backend can classify messages immediately after setup.
