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

Implemented: Resend-backed account verification, username/email login, rotating refresh sessions, MongoDB-backed direct messaging and message history, live presence/read/typing events, Cloudflare Realtime one-to-one WebRTC calling with call logs, Naive Bayes message sentiment, and on-demand AI summaries through NVIDIA NIM with Gemini and Ollama fallbacks. See [Backend/README.md](Backend/README.md), [Frontend/README.md](Frontend/README.md), and [ML/README.md](ML/README.md) for setup and module details.

Not implemented yet: group chats/conferences, voice-message file transfer, production deployment configuration, LMS ZIP packaging, project report, and demo video.
