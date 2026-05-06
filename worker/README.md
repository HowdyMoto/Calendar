# Nudge Auth Worker

Cloudflare Worker that handles Google OAuth on behalf of the Nudge PWA.

The PWA never sees the Google `client_secret` or `refresh_token`. It only
holds an opaque `session_id` (in `localStorage`) and exchanges it for a
short-lived Google access token via this Worker.

## One-time setup

```sh
cd worker

# 1. Create the KV namespace for sessions and copy the printed `id` into wrangler.toml
wrangler kv namespace create SESSIONS

# 2. Store secrets (paste the values when prompted)
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# 3. Deploy
wrangler deploy
```

After the first deploy, copy the printed Worker URL (looks like
`https://nudge-auth.<your-account>.workers.dev`) and add
`<that-url>/auth/callback` to the **Authorized redirect URIs** of the Nudge
OAuth client in Google Cloud Console.

## Local development

```sh
wrangler dev
```

Runs the Worker at `http://localhost:8787`. Add
`http://localhost:8787/auth/callback` to the same Google OAuth client
redirect URI list to test locally.

## Endpoints

| Method | Path             | Purpose                                                    |
|--------|------------------|------------------------------------------------------------|
| GET    | `/auth/start`    | Begins OAuth — redirects browser to Google consent         |
| GET    | `/auth/callback` | Google redirects here — finishes OAuth, sets session       |
| GET    | `/auth/token`    | Returns a fresh Google access token for the session        |
| POST   | `/auth/logout`   | Revokes the session (and refresh token at Google)          |
| GET    | `/health`        | Sanity check                                               |

`/auth/token` and `/auth/logout` require `Authorization: Bearer <session_id>`.
