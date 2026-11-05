# TeamFlow frontend

React + Vite + TypeScript client. Copy `.env.example` to `.env`, then run `npm install` and `npm run dev` from this directory. Set `VITE_API_URL` to the backend origin if it is not running at `http://localhost:8000`.

## Structure

- `src/App.tsx` owns the screen state and shared interactions.
- `src/components/auth/` contains account and one-time-code screens.
- `src/components/workspace/` contains the navigation rail, conversation list, chat room, details panel, and call preview.
- `src/components/` contains shared brand, avatar, icon, and toast components.
- `src/api/` contains the typed FastAPI auth client, configured with `VITE_API_URL`.
- `src/data/` contains prototype conversations and the example summary.
- `src/style.css` contains shared design tokens, component styles, responsive layouts, and light/dark themes.

## Current scope

The auth screens call the FastAPI registration, email-code verification, login, and current-user endpoints. The workspace remains interactive with local prototype data: theme switching, conversation search/filtering, message composition, conversation details, and call previews. Those chat features will connect as the backend grows. End-to-end auth requires working MongoDB Atlas and Resend settings in `Backend/.env`.
