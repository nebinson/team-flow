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

## Production deployment

The root `.github/workflows/deploy.yml` runs on every push to `main`; merging a pull request into `main` produces that push event and starts the same deployment. It connects to the VPS, fast-forwards `/var/www/team-flow`, syncs backend dependencies, builds the frontend with `VITE_API_URL=/` for the Nginx `/api/` proxy, restarts the backend service, and checks `/health`.

Configure these GitHub Actions repository secrets: `VPS_HOST`, `VPS_USER`, `SSH_PRIVATE_KEY`, and `TEAMFLOW_SYSTEMD_SERVICE` (the backend systemd unit name). `SSH_PORT` is optional and defaults to `22`. The VPS user needs Git access to this repository, `uv` and Node 20 available, and passwordless sudo permission to restart and inspect that service.

## Current implementation status

Implemented: Resend-backed account verification, username/email login, rotating refresh sessions, MongoDB-backed direct messaging and message history, live presence/read/typing events, Cloudflare Realtime one-to-one WebRTC calling with call logs, Naive Bayes message sentiment, on-demand AI summaries, and private AI chats with history reset using NVIDIA NIM, Gemini, or Ollama. See [Backend/README.md](Backend/README.md), [Frontend/README.md](Frontend/README.md), and [ML/README.md](ML/README.md) for setup and module details.

Not implemented yet: group chats/conferences, voice-message file transfer, LMS ZIP packaging, project report, and demo video.
