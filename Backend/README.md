# TeamFlow backend

FastAPI service using MongoDB Atlas. Install dependencies from this directory with uv sync, then start the development server with uv run uvicorn app.main:app --reload.

Copy .env.example to .env and set MONGODB_URI, a random JWT_SECRET of at least 32 characters, RESEND_API_KEY, and a verified EMAIL_FROM sender before using account endpoints. The API can start without those services configured; protected workflows return a configuration error until required settings are present.

## MongoDB collections

- users: normalized unique email, display name, Argon2 password hash, verification state, and timestamps.
- email_verifications: one hashed, single-use token per unverified user. MongoDB TTL removes expired records.

## Authentication endpoints

All routes are under /api/v1/auth:

- POST /register — { "name", "email", "password" }; creates an unverified account and sends a verification link through Resend.
- POST /resend-verification — { "email" }; sends another link when eligible, with a per-account cooldown.
- POST /verify-email — { "token" }; consumes the one-time token and verifies the account.
- POST /login — { "email", "password" }; returns a short-lived bearer access token after verification.
- GET /me — returns the authenticated user's public profile; send Authorization: Bearer <access_token>.

Registration and resend responses are generic to avoid exposing whether an email address has an account. The verification link points to the frontend /verify-email page, which will call the backend verification endpoint.
