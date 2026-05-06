// ── Auth via Cloudflare Worker BFF ──────────────────────
//
// The Worker holds the Google refresh token. The PWA only holds an
// opaque session_id (in localStorage) and asks the Worker for a fresh
// access_token whenever it needs to call Google APIs.

import { DISCOVERY_DOCS, WORKER_URL } from './config.js';
import { setLastStructureKey, setLastGutterKey } from './state.js';
import { showScreen, authScreen, loadingScreen, calendarScreen, setLoaderStatus } from './ui.js';
import { fetchEvents, fetchTasks } from './api.js';
import { fetchCalendarColors } from './colors.js';
import { renderEvents } from './render.js';
import { checkMorningBriefing, checkEveningBriefing } from './briefing.js';
import { startTimers } from './timers.js';
import { toggleSettings } from './settings.js';

const SESSION_KEY = 'nudge_session_id';

let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0;

export function gapiLoaded() {
  gapi.load('client', async () => {
    await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });

    // First load after returning from Worker /auth/callback puts the
    // session_id in the URL fragment. Capture it, then strip from the URL.
    const fragMatch = window.location.hash.match(/session_id=([a-f0-9]+)/);
    if (fragMatch) {
      localStorage.setItem(SESSION_KEY, fragMatch[1]);
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    // One-time migration: clear the old GIS-style token, no longer used.
    localStorage.removeItem('gapi_token');

    if (localStorage.getItem(SESSION_KEY)) {
      const ok = await ensureAccessToken();
      if (ok) onAuthed();
    }
  });
}

// Kept as a no-op so existing imports/script hooks don't break during the
// migration. The GIS client library is no longer loaded.
export function gisLoaded() {}

export function handleAuth() {
  const returnTo = window.location.origin + window.location.pathname;
  window.location.href = `${WORKER_URL}/auth/start?return_to=${encodeURIComponent(returnTo)}`;
}

export async function handleLogout() {
  const sessionId = localStorage.getItem(SESSION_KEY);
  if (sessionId) {
    fetch(`${WORKER_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionId}` },
    }).catch(() => {});
  }
  localStorage.removeItem(SESSION_KEY);
  cachedAccessToken = null;
  cachedAccessTokenExpiresAt = 0;
  if (typeof gapi !== 'undefined') gapi.client?.setToken(null);
  toggleSettings();
  showScreen(authScreen);
}

// Returns true if gapi.client now has a valid access token. Asks the Worker
// to mint a fresh one when our cached copy is missing or near expiry.
export async function ensureAccessToken() {
  if (cachedAccessToken && cachedAccessTokenExpiresAt - Date.now() > 60_000) {
    gapi.client.setToken({ access_token: cachedAccessToken });
    return true;
  }
  const sessionId = localStorage.getItem(SESSION_KEY);
  if (!sessionId) return false;
  try {
    const resp = await fetch(`${WORKER_URL}/auth/token`, {
      headers: { 'Authorization': `Bearer ${sessionId}` },
    });
    if (!resp.ok) {
      if (resp.status === 401) localStorage.removeItem(SESSION_KEY);
      return false;
    }
    const { access_token, expires_in } = await resp.json();
    cachedAccessToken = access_token;
    cachedAccessTokenExpiresAt = Date.now() + expires_in * 1000;
    gapi.client.setToken({ access_token });
    return true;
  } catch {
    return false;
  }
}

// Replaces the old GIS popup-based silent reauth. Called from api.js on 401s.
export async function silentReauth() {
  cachedAccessToken = null;
  cachedAccessTokenExpiresAt = 0;
  return ensureAccessToken();
}

async function onAuthed() {
  showScreen(loadingScreen);
  await Promise.all([fetchEvents(), fetchCalendarColors(), fetchTasks()]);
  showScreen(calendarScreen);
  requestAnimationFrame(() => {
    setLastStructureKey('');
    setLastGutterKey('');
    renderEvents();
    startTimers();
    checkMorningBriefing();
    checkEveningBriefing();
  });
}
