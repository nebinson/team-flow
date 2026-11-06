# TeamFlow backend

FastAPI service using MongoDB Atlas. Install dependencies from this directory with uv sync, then start the development server with uv run uvicorn app.main:app --reload.

Copy .env.example to .env and set MONGODB_URI, a random JWT_SECRET of at least 32 characters, RESEND_API_KEY, and a verified EMAIL_FROM sender before using account endpoints. Set FRONTEND_ORIGIN to the exact browser origin, including scheme and port (for example, `http://botpeter17:5173`). The API can start without services configured; protected workflows return a configuration error until required settings are present.

For calls, set `CLOUDFLARE_TURN_KEY_ID` to the TURN key UID and `CLOUDFLARE_TURN_KEY_TOKEN` to its secret key value. Set `CLOUDFLARE_TURN_CREDENTIAL_TTL` to the desired credential lifetime in seconds (capped at 48 hours). The long-lived token remains on the backend; `/api/v1/calls/ice-servers` returns short-lived credentials to authenticated callers.

## MongoDB collections

- users: normalized unique email and username, first/last name, gender preference, Argon2 password hash, verification state, last-seen time, and timestamps. Username uniqueness is partial so existing accounts without usernames remain readable.
- email_verifications: one HMAC-hashed, six-digit code per unverified user, with expiry, resend timestamp, and a five-attempt limit. MongoDB TTL removes expired records.
- conversations: one-to-one participant IDs, a deterministic unique direct-chat key, per-member read timestamps, activity time, and a last-message preview.
- messages: conversation ID, sender ID, text body, type, and creation time.
- call_logs: call ID, conversation and participants, caller/callee, audio/video type, outcome, and start/connect/end timestamps. Call signaling writes status transitions so the Calls tab can show history and connected-call duration.
- refresh_tokens: SHA-256 hashes of rotating refresh tokens, user ID, and timestamps. Raw refresh tokens are returned only at sign-in/rotation and are not persisted in MongoDB.
- ai_chats and ai_chat_messages: one private assistant thread per user and its persisted user/assistant turns. Restart permanently deletes that user's saved AI messages.

## Authentication endpoints

All routes are under /api/v1/auth:

- POST /register — { "first_name", "last_name", "username", "email", "gender", "password" }; creates an unverified account and emails a six-digit code through Resend.
- POST /resend-verification — { "identifier" }; emails a replacement code by username or email when eligible, with an atomic per-account cooldown.
- POST /verify-email — { "identifier", "code" }; verifies the account using its current unexpired code. Five invalid codes exhaust the current code; resend after the cooldown to continue.
- POST /login — { "identifier", "password" }; accepts a username or email and returns a short-lived bearer access token after verification. Unverified accounts return a masked email hint so the client can offer verification.
- POST /refresh — { "refresh_token" }; consumes a refresh token once and rotates the refresh/access-token pair.
- POST /logout — { "refresh_token" }; revokes the current refresh session.
- GET /me — returns the authenticated user's public profile; send Authorization: Bearer <access_token>.

Registration and resend responses are generic to avoid exposing whether an email address has an account. The six-digit code expires after ten minutes; five invalid attempts require requesting a new code.

Access tokens expire after `ACCESS_TOKEN_MINUTES` (30 by default). The frontend automatically exchanges a valid refresh token after a protected request returns 401. Refresh tokens rotate on each use and expire after `REFRESH_TOKEN_DAYS` (30 by default); they are held in browser memory, so a full reload requires a new sign-in.

## Usernames and registration fields

Registration requires `first_name`, `last_name`, `username`, `email`, `gender`, and `password`. Usernames are lower-case letters, numbers, and underscores, 3–24 characters. Gender values are `female`, `male`, `non_binary`, `other`, and `prefer_not_to_say`; gender is stored on the account and omitted from directory/profile responses. Login accepts `{ "identifier", "password" }`, where identifier is a username or email. An unknown identifier returns 404 with a register prompt.

## Direct messaging endpoints

All endpoints require `Authorization: Bearer <access_token>`:

- `GET /api/v1/users/search?q=...` — search accepted friends for the new-conversation dialog.
- `GET /api/v1/people?q=...` — list verified coworkers with friend relationship state.
- `GET /api/v1/people/requests` — list incoming and outgoing friend requests.
- `POST /api/v1/people/requests/{user_id}` — send a request; `POST /api/v1/people/requests/{user_id}/accept` accepts one; `DELETE` cancels or declines a pending request.
- `POST /api/v1/conversations/direct` with `{ "username" }` — create or reopen a one-to-one thread; new threads require an accepted friend request.
- `GET /api/v1/conversations` — list threads for the signed-in user, newest activity first.
- `GET /api/v1/conversations/{id}/messages?limit=50&before=...` — load a history page; limit is 1–100.
- `POST /api/v1/conversations/{id}/messages` with `{ "body" }` — persist and return a text message (up to 4,000 characters).
- `POST /api/v1/conversations/{id}/read` — save the member's read position and notify the other participant.
- `GET /api/v1/calls/ice-servers` — get short-lived Cloudflare ICE/TURN credentials for a call.
- `GET /api/v1/calls/logs?limit=100` — list recent calls involving the signed-in user, including peer, direction, outcome, and duration when connected.
- `WS /api/v1/ws` — authenticated workspace events for new conversations/messages, presence, read receipts, and typing. The browser sends `teamflow` and `bearer.<access-token>` as WebSocket subprotocols; the server accepts only `teamflow`.
- `POST /api/v1/ai/conversations/{id}/summary` — summarize the most recent 150 messages for a conversation participant using the first available provider in NVIDIA NIM → Gemini → Ollama order.
- `GET /api/v1/ai/chat` — return the signed-in user's private AI chat and up to 100 latest messages, creating the thread if needed.
- `POST /api/v1/ai/chat/messages` with `{ "content" }` — generate and store a user/assistant turn (message limit 4,000 characters); the model receives up to the latest 30 saved messages.
- `POST /api/v1/ai/chat/restart` — permanently delete the signed-in user's AI chat messages so future requests start without previous context.

Conversation membership is checked for reads, writes, typing, and call-signaling events. Existing direct chats remain established connections; new chats require an accepted friendship. One-to-one offers, answers, ICE candidates, and call termination are relayed to the other participant over the workspace WebSocket; audio/video media travels through WebRTC, using Cloudflare TURN when direct connectivity is blocked. Messages and read positions are stored in MongoDB. The current WebSocket fan-out and online-presence registry are in-process for local development; multi-worker deployment will need shared pub/sub and presence storage. Browsers require HTTPS (or localhost) for microphone and camera access, so cross-device development calls need an HTTPS frontend origin.

WebSocket call events also maintain the `call_logs` collection: offers create a ringing entry; answers mark it ongoing; rejection, timeout, busy, offline, and hang-up events record the corresponding outcome. Older calls from before call logging was added are not backfilled.

## AI features

Message sends are scored by the trained Naive Bayes model in `ML/models/sentiment_naive_bayes.joblib`; labels are stored with the message and returned to the chat UI. Train/evaluate it with `uv run --project Backend python ML/train_sentiment.py`. If `SENTIMENT_MODEL_PATH` is unset, the backend loads the default artifact in `ML/models/`.

Conversation summaries and private AI chat use the OpenAI-compatible chat-completions interface. Configure `NIM_API_KEY`, `NIM_MODEL`, and optionally `NIM_BASE_URL` for the primary hosted NVIDIA NIM provider. `GEMINI_API_KEY` + `GEMINI_MODEL` and `OLLAMA_BASE_URL` + `OLLAMA_MODEL` activate ordered fallbacks. Provider failures are logged by provider and the next configured provider is tried. Summary content is generated on demand and is not saved to message history; AI chat turns are stored in the user's private AI thread. AI prompts are sent to the selected provider for inference, subject to its data handling policy.
