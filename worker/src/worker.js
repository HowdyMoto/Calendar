// ── Nudge Calendar OAuth Worker ─────────────────────────
//
// Acts as the Backend-for-Frontend (BFF) for Google OAuth so the PWA can
// hold a long-lived session without ever seeing the refresh token. Flow:
//
//   PWA -> /auth/start    -> redirect to Google consent
//   Google -> /auth/callback -> exchange code, store refresh_token in KV,
//                                redirect to PWA with opaque session_id
//   PWA -> /auth/token    -> returns a fresh access_token (refreshes via
//                            Google's token endpoint when needed)
//   PWA -> /auth/logout   -> revokes refresh_token at Google, clears KV

const GOOGLE_AUTH_URL  = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 days; bumped on every use
const STATE_TTL_SECONDS   = 600;               // 10 minutes for OAuth round-trip
const ACCESS_TOKEN_BUFFER_MS = 60 * 1000;      // refresh 60s before expiry

const ALLOWED_ORIGINS = [
  'https://wrightbagwell.com',
  'http://localhost:8080',
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') return preflight(origin);

    try {
      switch (url.pathname) {
        case '/auth/start':    return await handleStart(url, env);
        case '/auth/callback': return await handleCallback(url, env);
        case '/auth/token':    return await handleToken(request, env, origin);
        case '/auth/logout':   return await handleLogout(request, env, origin);
        case '/health':        return json({ ok: true }, 200, origin);
      }
    } catch (err) {
      console.error('worker error:', err);
      return json({ error: 'internal_error', message: err.message }, 500, origin);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ── /auth/start ─────────────────────────────────────────
// PWA hits this directly via window.location to kick off OAuth.

async function handleStart(url, env) {
  const returnTo = url.searchParams.get('return_to') || env.PWA_ORIGIN + '/calendar/';

  if (!isSafeReturnTo(returnTo, env.PWA_ORIGIN)) {
    return new Response('Invalid return_to', { status: 400 });
  }

  const state = randomId();
  await env.SESSIONS.put(`state:${state}`, returnTo, { expirationTtl: STATE_TTL_SECONDS });

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: `${url.origin}/auth/callback`,
    response_type: 'code',
    scope: env.GOOGLE_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
    include_granted_scopes: 'true',
  });

  return Response.redirect(`${GOOGLE_AUTH_URL}?${params}`, 302);
}

// ── /auth/callback ──────────────────────────────────────
// Google redirects the user's browser here after consent.

async function handleCallback(url, env) {
  const code  = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return new Response(`OAuth error: ${error}`, { status: 400 });
  if (!code || !state) return new Response('Missing code or state', { status: 400 });

  const stateKey = `state:${state}`;
  const returnTo = await env.SESSIONS.get(stateKey);
  if (!returnTo) return new Response('State expired or invalid', { status: 400 });
  await env.SESSIONS.delete(stateKey);

  const tokens = await exchangeCode(code, `${url.origin}/auth/callback`, env);
  if (!tokens.refresh_token) {
    return new Response(
      'Google did not return a refresh_token. Try revoking access at ' +
      'https://myaccount.google.com/permissions and signing in again.',
      { status: 500 }
    );
  }

  const sessionId = randomId();
  await env.SESSIONS.put(
    `session:${sessionId}`,
    JSON.stringify({
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expires_at: Date.now() + tokens.expires_in * 1000,
      created_at: Date.now(),
      last_used_at: Date.now(),
    }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );

  const dest = new URL(returnTo);
  dest.hash = `session_id=${sessionId}`;
  return Response.redirect(dest.toString(), 302);
}

// ── /auth/token ─────────────────────────────────────────
// PWA calls this with `Authorization: Bearer <session_id>` to get a fresh
// Google access token. We refresh transparently when the cached one is stale.

async function handleToken(request, env, origin) {
  if (!isAllowedOrigin(origin)) return json({ error: 'forbidden' }, 403, origin);

  const sessionId = bearer(request);
  if (!sessionId) return json({ error: 'no_session' }, 401, origin);

  const sessionKey = `session:${sessionId}`;
  const stored = await env.SESSIONS.get(sessionKey);
  if (!stored) return json({ error: 'invalid_session' }, 401, origin);

  const session = JSON.parse(stored);

  if (session.access_token && session.access_token_expires_at - Date.now() > ACCESS_TOKEN_BUFFER_MS) {
    return json({
      access_token: session.access_token,
      expires_in: Math.floor((session.access_token_expires_at - Date.now()) / 1000),
    }, 200, origin);
  }

  let refreshed;
  try {
    refreshed = await refreshAccessToken(session.refresh_token, env);
  } catch (e) {
    await env.SESSIONS.delete(sessionKey);
    return json({ error: 'refresh_failed', message: e.message }, 401, origin);
  }

  session.access_token = refreshed.access_token;
  session.access_token_expires_at = Date.now() + refreshed.expires_in * 1000;
  session.last_used_at = Date.now();
  if (refreshed.refresh_token) session.refresh_token = refreshed.refresh_token;

  await env.SESSIONS.put(sessionKey, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });

  return json({
    access_token: refreshed.access_token,
    expires_in: refreshed.expires_in,
  }, 200, origin);
}

// ── /auth/logout ────────────────────────────────────────

async function handleLogout(request, env, origin) {
  if (!isAllowedOrigin(origin)) return json({ error: 'forbidden' }, 403, origin);

  const sessionId = bearer(request);
  if (sessionId) {
    const sessionKey = `session:${sessionId}`;
    const stored = await env.SESSIONS.get(sessionKey);
    if (stored) {
      const { refresh_token } = JSON.parse(stored);
      // Best-effort revoke at Google. Failures here don't matter; the local
      // session is what controls the PWA's access from now on.
      fetch(GOOGLE_REVOKE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: refresh_token }),
      }).catch(() => {});
    }
    await env.SESSIONS.delete(sessionKey);
  }

  return json({ ok: true }, 200, origin);
}

// ── Helpers ─────────────────────────────────────────────

async function exchangeCode(code, redirectUri, env) {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!resp.ok) throw new Error(`token exchange failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

async function refreshAccessToken(refreshToken, env) {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!resp.ok) throw new Error(`refresh failed: ${resp.status} ${await resp.text()}`);
  return resp.json();
}

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function randomId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function isAllowedOrigin(origin) {
  return ALLOWED_ORIGINS.includes(origin);
}

function isSafeReturnTo(value, pwaOrigin) {
  try {
    const u = new URL(value);
    return u.origin === pwaOrigin || u.origin === 'http://localhost:8080';
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  if (!isAllowedOrigin(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function preflight(origin) {
  return new Response(null, { status: 204, headers: corsHeaders(origin) });
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}
