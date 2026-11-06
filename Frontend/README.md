# TeamFlow frontend

React + Vite + TypeScript client. Copy `.env.example` to `.env`, then run `npm install` and `npm run dev` from this directory. For another computer, set `VITE_API_URL` to the backend computer's reachable URL (for example, `http://botpeter17:8000`) and allow the exact frontend origin in backend `FRONTEND_ORIGIN`. When Nginx proxies `/api/` to FastAPI on the same host, set `VITE_API_URL=/` before building; the client will use same-origin HTTP and WebSocket connections (`/api/v1/...` and `/api/v1/ws`).

## Structure

- `src/App.tsx` owns the screen state and shared interactions.
- `src/components/auth/` contains account and one-time-code screens.
- `src/components/workspace/` contains the navigation rail, conversation list, chat room, people directory and friend requests, call history, AI summary panel, and call preview.
- `src/components/` contains shared brand, avatar, icon, and toast components.
- `src/api/` contains the typed FastAPI auth client, configured with `VITE_API_URL`.
- `src/api/messaging.ts` contains conversation, history, send, directory-search, and WebSocket calls plus API-to-UI adapters.
- `src/api/calls.ts` requests authenticated, short-lived ICE credentials and persisted call history from the backend.
- `src/api/ai.ts` requests provider-generated conversation summaries.
- `src/components/workspace/AiChatRoom.tsx` renders the persisted private AI chat, provider attribution, and confirmed history reset. Assistant replies support GitHub Flavored Markdown (including fenced code, tables, and task lists); user messages remain plain text. Markdown is sanitized before rendering and raw HTML is not enabled.
- `src/hooks/useWebRtcCall.ts` owns peer connections, media tracks, signaling, and call controls.
- `src/style.css` contains shared design tokens, component styles, responsive layouts, and light/dark themes.

## Current scope

The auth screens call the FastAPI registration, email-code verification, login, current-user, rotating refresh, and logout endpoints. The frontend automatically refreshes access tokens after authorized API requests receive a 401; refresh tokens are memory-only and a page reload requires sign-in. Users can manage their profile, set a picture in private Cloudflare R2 storage, change their name and username, change their sign-in email after verification, and update their password. The People view lists accepted friends, supports coworker discovery, and manages incoming and outgoing friend requests. New direct conversations can be started with accepted friends; existing conversations remain available. Direct chat composers send images and documents to private Cloudflare R2 storage and record voice messages with the browser microphone; attachments load through authenticated conversation-member routes. Users receive workspace events over an authenticated WebSocket. Last seen, presence, typing indicators, read receipts, and incoming-message notification sounds reflect account activity. Sent messages receive persisted Naive Bayes sentiment labels. Conversation details can generate an on-demand summary using the first available NVIDIA NIM, Gemini, or Ollama provider. The Messages sidebar also provides a private AI assistant whose history is stored per account and can be permanently erased with Restart conversation; assistant requests use the same provider fallback chain. One-to-one voice and video calls use WebRTC media with Cloudflare Realtime TURN credentials minted by the backend; the Calls view lists persisted call outcomes. Call access requires a secure browser origin for microphone/camera permissions. Group chats remain future work.
