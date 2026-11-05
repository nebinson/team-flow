# TeamFlow frontend

React + Vite + TypeScript client. Copy `.env.example` to `.env`, then run `npm install` and `npm run dev` from this directory. For another computer, set `VITE_API_URL` to the backend computer's reachable URL (for example, `http://botpeter17:8000`) and allow the exact frontend origin in backend `FRONTEND_ORIGIN`.

## Structure

- `src/App.tsx` owns the screen state and shared interactions.
- `src/components/auth/` contains account and one-time-code screens.
- `src/components/workspace/` contains the navigation rail, conversation list, chat room, details panel, and call preview.
- `src/components/` contains shared brand, avatar, icon, and toast components.
- `src/api/` contains the typed FastAPI auth client, configured with `VITE_API_URL`.
- `src/api/messaging.ts` contains conversation, history, send, directory-search, and WebSocket calls plus API-to-UI adapters.
- `src/style.css` contains shared design tokens, component styles, responsive layouts, and light/dark themes.

## Current scope

The auth screens call the FastAPI registration, email-code verification, login, and current-user endpoints. Unverified accounts can request a verification code from the login prompt. Signed-in users load only persisted direct conversations and message history, can find verified coworkers and start a direct chat, and receive workspace events over an authenticated WebSocket. Last seen, presence, typing indicators, read receipts, and incoming-message notification sounds reflect account activity. Summaries, sentiment analysis, group chats, and WebRTC media remain future integrations. End-to-end auth and messaging require valid MongoDB Atlas and Resend settings in `Backend/.env`.
