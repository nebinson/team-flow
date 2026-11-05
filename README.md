# TeamFlow

TeamFlow is a real-time internal communication platform with messaging, one-to-one voice/video calls, message sentiment analysis, and AI conversation summaries.

## Project layout

- `Frontend/` — React and Vite web client.
- `Backend/` — FastAPI service, MongoDB Atlas integration, Resend email verification, hosted NVIDIA NIM integration, and WebSocket endpoints.
- `ML/` — Sentiment dataset, Naive Bayes training notebook/code, and saved model artifacts.

## Development setup

Prerequisites: Node.js, Python 3.12+, `uv`, and a MongoDB Atlas database.

1. Copy `Backend/.env.example` to `Backend/.env` and fill in the development values.
2. Start the backend:
   ```bash
   cd Backend
   uv sync
   uv run uvicorn app.main:app --reload
   ```
3. Start the frontend in another terminal:
   ```bash
   cd Frontend
   npm install
   npm run dev
   ```
4. Open the URL printed by Vite. The backend API is available at `http://localhost:8000`; API docs are at `/docs`.

Do not commit `.env` files or production credentials. Configure separate environment variables for local development and deployment.

## Current implementation status

The backend has MongoDB user and email-verification document shapes, indexes, and email-code authentication routes. The frontend has modular auth, six-digit code-entry, and chat workspace screens; auth is wired to the API while chat remains prototype-driven. See [Backend/README.md](Backend/README.md) and [Frontend/README.md](Frontend/README.md) for details.
