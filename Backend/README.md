# TeamFlow backend

FastAPI service using MongoDB Atlas. Install dependencies from this directory with uv sync, then start the development server with uv run uvicorn app.main:app --reload.

Copy .env.example to .env and set MONGODB_URI, a random JWT_SECRET of at least 32 characters, RESEND_API_KEY, and a verified EMAIL_FROM sender before using account endpoints. The API can start without those services configured; protected workflows return a configuration error until required settings are present.

## MongoDB collections

- users: normalized unique email and username, first/last name, gender preference, Argon2 password hash, verification state, and timestamps. Username uniqueness is partial so existing accounts without usernames remain readable.
- email_verifications: one HMAC-hashed, six-digit code per unverified user, with expiry, resend timestamp, and a five-attempt limit. MongoDB TTL removes expired records.
- conversations: one-to-one participant IDs, a deterministic unique direct-chat key, activity time, and a last-message preview.
- messages: conversation ID, sender ID, text body, type, and creation time.

## Authentication endpoints

All routes are under /api/v1/auth:

- POST /register — { "name", "email", "password" }; creates an unverified account and emails a six-digit code through Resend.
- POST /resend-verification — { "email" }; emails a replacement code when eligible, with an atomic per-account cooldown.
- POST /verify-email — { "email", "code" }; verifies the account using its current unexpired code. Five invalid codes exhaust the current code; resend after the cooldown to continue.
- POST /login — { "email", "password" }; returns a short-lived bearer access token after verification.
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
- `WS /api/v1/ws/conversations/{id}` — receive new message events. The browser sends `teamflow` and `bearer.<access-token>` as WebSocket subprotocols; the server accepts only `teamflow`.

Conversation membership is checked for reads, writes, and sockets. Messages are saved before being broadcast. The current WebSocket fan-out is in-process for local development; multi-worker deployment will need a shared pub/sub layer.
