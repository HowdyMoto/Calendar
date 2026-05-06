# Nudge Calendar

A minimal PWA that turns your phone into an always-on desk calendar. Connects to Google Calendar and shows today's events with live countdowns, playful animations, and color-coded urgency.

## Dev Workflow

- `npm run dev` — Vite dev server on port 8080 (matches OAuth redirect config)
- `npm run build` — generates icons + production build to `dist/`
- `.env` must contain `VITE_GOOGLE_CLIENT_ID=<your client id>`
- Deployed to GitHub Pages via `.github/workflows/deploy.yml`

## Architecture

Two pieces:

1. **PWA** — vanilla JS client at `wrightbagwell.com/calendar`, source in `src/`
2. **Auth Worker** — Cloudflare Worker BFF for Google OAuth, source in `worker/src/worker.js`. Holds the Google `client_secret` and `refresh_token` so the PWA only ever holds a short-lived access token. See `worker/README.md` for setup.

Auth flow:
- User taps "Sign in with Google" → PWA redirects to Worker `/auth/start`
- Worker redirects to Google consent → user approves → Google calls Worker `/auth/callback`
- Worker exchanges code for tokens, stores `refresh_token` in Cloudflare KV, generates opaque `session_id`, redirects PWA back with `#session_id=...`
- PWA stores `session_id` in `localStorage`
- Whenever the PWA needs a Google access token, it calls Worker `/auth/token` with the `session_id` as a Bearer header. The Worker returns a fresh access token (refreshing transparently against Google when needed)

Vanilla JS (no framework), Vite build, ES modules. All PWA source is in `src/`:

- `app.js` — Entry point, bootstrap, window globals for inline handlers
- `config.js` — Constants, env vars, DEMO_MODE flag
- `state.js` — Shared mutable state with setter functions
- `auth.js` — Google OAuth (login, logout, silent reauth)
- `api.js` — Google Calendar & Tasks API, profile photo fetching
- `render.js` — Time grid, event card HTML, DOM diffing
- `colors.js` — Calendar color palettes, urgency-based opacity/contrast
- `animations.js` — Emoji physics animation, event dismiss interaction
- `briefing.js` — Morning briefing overlay
- `settings.js` — Settings panel, display scale, tasks toggle
- `timers.js` — Render/refresh intervals, midnight reset
- `ui.js` — Screen management, scroll tracking, pull-to-refresh, wake lock, service worker
- `demo.js` — Demo mode sample data
- `utils.js` — Shared pure helpers (escapeHtml, formatCountdown, etc.)

Static assets live in `public/` (copied as-is to dist). `index.html` is at the project root (Vite entry point).

## Text Legibility

Event cards can be any color the user sets in Google Calendar. Never hardcode text to white or dark — always use `urgencyTextColor()` from `colors.js`, which picks white or dark text based on the effective background luminance. Any UI that overlays a card (details panel, badges, countdowns) must inherit the card's text color via `--card-text` and `--card-sub` CSS variables. The avatar circle uses `rgba(0,0,0,0.25)` background to stay visible on both light and dark cards.

## Google OAuth & People API

Hard-won lessons from verification and avatar debugging:

- **No unused scopes.** A scope declared in `config.js` but never called will fail Google's "minimum scopes" verification check. Every scope in `SCOPES` must map to an actual API call.
- **Use `people.connections.list` for attendee avatars, not `searchContacts`.** `searchContacts` requires a warmup request and even then returns inconsistent results. `connections.list` with `personFields=emailAddresses,photos` bulk-pulls all saved contacts in one paginated pass — deterministic and simpler.
- **`otherContacts.list` rarely has photos.** Auto-collected Gmail contacts usually lack photo data. Keep it as last-resort fallback only, not primary path.
- **Self avatar requires `userinfo.profile`.** `contacts.readonly` does NOT grant `people/me` access — that call 403s without `userinfo.profile`. The scope is non-sensitive and does not affect OAuth verification for sensitive scopes.
- **`userinfo.profile` returns photos but NOT `emailAddresses`.** Don't ask `people/me` for `emailAddresses` — you'll get `undefined`. Instead find self email by scanning events for `organizer.self === true` or `attendees[].self === true`; Google Calendar already knows who "me" is.
- **Avatar rendering: photo OR initials, never both.** If both are rendered in the same DOM element, initials paint over the image due to DOM order. Use `referrerpolicy="no-referrer"` on Google user-content image URLs, and `onerror="this.remove()"` for graceful fallback.
- **After changing scopes, users must re-consent — not just reload.** Google silently reuses prior grants. Tell users to revoke at `myaccount.google.com/permissions` first, then sign back in, to actually receive a token with the new scope.

## Versioning

Bump the version in `package.json` on every push:
- **Patch** (2.0.x): bug fixes, styling tweaks, copy changes, refactors
- **Minor** (2.x.0): new user-facing features or behavior changes
- **Major** (x.0.0): breaking changes, large rewrites, or architectural shifts

When committing, update the `"version"` field in `package.json` as part of the commit.
