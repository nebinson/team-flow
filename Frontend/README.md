# TeamFlow frontend

React + Vite + TypeScript client. From this directory, run `npm install` and `npm run dev` to open the local prototype.

## Structure

- `src/App.tsx` owns the screen state and shared interactions.
- `src/components/auth/` contains account and one-time-code screens.
- `src/components/workspace/` contains the navigation rail, conversation list, chat room, details panel, and call preview.
- `src/components/` contains shared brand, avatar, icon, and toast components.
- `src/data/` contains prototype conversations and the example summary.
- `src/style.css` contains shared design tokens, component styles, responsive layouts, and light/dark themes.

## Current scope

The UI is interactive with local prototype data: theme switching, conversation search/filtering, message composition, the email-code entry interaction, conversation details, and call previews. It is not connected to the backend yet. The backend currently accepts a long verification-link token; before wiring the screens together, we should align that endpoint with the six-digit email-code experience.
