# TeamFlow frontend

React + Vite + TypeScript client. Copy `.env.example` to `.env`, then run `npm install` and `npm run dev` from this directory. Set `VITE_API_URL` to the backend origin if it is not running at `http://localhost:8000`.

## Structure

- `src/App.tsx` owns the screen state and shared interactions.
- `src/components/auth/` contains account and one-time-code screens.
- `src/components/workspace/` contains the navigation rail, conversation list, chat room, details panel, and call preview.
- `src/components/` contains shared brand, avatar, icon, and toast components.
- `src/api/` contains the typed FastAPI auth client, configured with `VITE_API_URL`.
- `src/api/messaging.ts` contains conversation, history, send, directory-search, and WebSocket calls plus API-to-UI adapters.
- `src/data/` contains prototype conversations and the example summary.
- `src/style.css` contains shared design tokens, component styles, responsive layouts, and light/dark themes.

## Current scope

The auth screens call the FastAPI registration, email-code verification, login, and current-user endpoints. Signed-in users load direct conversations and message history from the API, can find verified coworkers and start a direct chat, send persisted messages, and receive live updates over authenticated WebSockets. The workspace preview still uses local sample data. Summaries, sentiment analysis, presence, group chats, and WebRTC media remain future integrations. End-to-end auth and messaging require valid MongoDB Atlas and Resend settings in `Backend/.env`.
