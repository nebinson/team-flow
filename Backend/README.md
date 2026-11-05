# TeamFlow backend

FastAPI service using MongoDB Atlas. Install dependencies from this directory with uv sync, then start the development server with uv run uvicorn app.main:app --reload.

Copy .env.example to .env and set MONGODB_URI, a random JWT_SECRET of at least 32 characters, RESEND_API_KEY, and a verified EMAIL_FROM sender before using account endpoints. Set FRONTEND_ORIGIN to the exact browser origin, including scheme and port (for example, `http://botpeter17:5173`). The API can start without services configured; protected workflows return a configuration error until required settings are present.

For calls, set `CLOUDFLARE_TURN_KEY_ID` to the TURN key UID and `CLOUDFLARE_TURN_KEY_TOKEN` to its secret key value. Set `CLOUDFLARE_TURN_CREDENTIAL_TTL` to the desired credential lifetime in seconds (capped at 48 hours). The long-lived token remains on the backend; `/api/v1/calls/ice-servers` returns short-lived credentials to authenticated callers.

## MongoDB collections

- users: normalized unique email and username, first/last name, gender preference, Argon2 password hash, verification state, last-seen time, and timestamps. Username uniqueness is partial so existing accounts without usernames remain readable.
- email_verifications: one HMAC-hashed, six-digit code per unverified user, with expiry, resend timestamp, and a five-attempt limit. MongoDB TTL removes expired records.
- conversations: one-to-one participant IDs, a deterministic unique direct-chat key, per-member read timestamps, activity time, and a last-message preview.
- messages: conversation ID, sender ID, text body, type, and creation time.

## Authentication endpoints

All routes are under /api/v1/auth:

- POST /register — { "first_name", "last_name", "username", "email", "gender", "password" }; creates an unverified account and emails a six-digit code through Resend.
- POST /resend-verification — { "identifier" }; emails a replacement code by username or email when eligible, with an atomic per-account cooldown.
- POST /verify-email — { "identifier", "code" }; verifies the account using its current unexpired code. Five invalid codes exhaust the current code; resend after the cooldown to continue.
- POST /login — { "identifier", "password" }; accepts a username or email and returns a short-lived bearer access token after verification. Unverified accounts return a masked email hint so the client can offer verification.
- GET /me — returns the authenticated user's public profile; send Authorization: Bearer <access_token>.

Registration and resend responses are generic to avoid exposing whether an email address has an account. The six-digit code expires after ten minutes; five invalid attempts require requesting a new code.

## Usernames and registration fields

Registration requires `first_name`, `last_name`, `username`, `email`, `gender`, and `password`. Usernames are lower-case letters, numbers, and underscores, 3–24 characters. Gender values are `female`, `male`, `non_binary`, `other`, and `prefer_not_to_say`; gender is stored on the account and omitted from directory/profile responses. Login accepts `{ "identifier", "password" }`, where identifier is a username or email. An unknown identifier returns 404 with a register prompt.

## Direct messaging endpoints

All endpoints require `Authorization: Bearer <access_token>`:

- `GET /api/v1/users/search?q=...` — search verified coworkers by username or name.
- `POST /api/v1/conversations/direct` with `{ "username" }` — create or reopen a one-to-one thread.
- `GET /api/v1/conversations` — list threads for the signed-in user, newest activity first.
- `GET /api/v1/conversations/{id}/messages?limit=50&before=...` — load a history page; limit is 1–100.
- `POST /api/v1/conversations/{id}/messages` with `{ "body" }` — persist and return a text message (up to 4,000 characters).
- `POST /api/v1/conversations/{id}/read` — save the member's read position and notify the other participant.
- `GET /api/v1/calls/ice-servers` — get short-lived Cloudflare ICE/TURN credentials for a call.
- `WS /api/v1/ws` — authenticated workspace events for new conversations/messages, presence, read receipts, and typing. The browser sends `teamflow` and `bearer.<access-token>` as WebSocket subprotocols; the server accepts only `teamflow`.

Conversation membership is checked for reads, writes, typing, and call-signaling events. One-to-one offers, answers, ICE candidates, and call termination are relayed to the other participant over the workspace WebSocket; audio/video media travels through WebRTC, using Cloudflare TURN when direct connectivity is blocked. Messages and read positions are stored in MongoDB. The current WebSocket fan-out and online-presence registry are in-process for local development; multi-worker deployment will need shared pub/sub and presence storage. Browsers require HTTPS (or localhost) for microphone and camera access, so cross-device development calls need an HTTPS frontend origin.
