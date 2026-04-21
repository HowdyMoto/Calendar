// ── Google OAuth ────────────────────────────────────────

import { CLIENT_ID, SCOPES, DISCOVERY_DOCS } from './config.js';
import { tokenClient, setTokenClient, setLastStructureKey, setLastGutterKey } from './state.js';
import { showScreen, authScreen, loadingScreen, calendarScreen } from './ui.js';
import { fetchEvents, fetchTasks } from './api.js';
import { fetchCalendarColors } from './colors.js';
import { renderEvents } from './render.js';
import { checkMorningBriefing, checkEveningBriefing } from './briefing.js';
import { startTimers } from './timers.js';
import { toggleSettings } from './settings.js';

let reauthResolve = null;

function saveToken() {
  localStorage.setItem('gapi_token', JSON.stringify(gapi.client.getToken()));
}

export function gapiLoaded() {
  gapi.load('client', async () => {
    await gapi.client.init({ discoveryDocs: DISCOVERY_DOCS });
    const stored = localStorage.getItem('gapi_token');
    if (stored) {
      gapi.client.setToken(JSON.parse(stored));
      onAuthed();
    }
  });
}

export function gisLoaded() {
  const tc = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (response) => {
      if (reauthResolve) {
        const resolve = reauthResolve;
        reauthResolve = null;
        if (response.error) {
          resolve(false);
        } else {
          saveToken();
          resolve(true);
        }
        return;
      }
      if (response.error) return;
      saveToken();
      onAuthed();
    },
  });
  setTokenClient(tc);
}

export function handleAuth() {
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

export function handleLogout() {
  const token = gapi.client.getToken();
  if (token) google.accounts.oauth2.revoke(token.access_token);
  gapi.client.setToken(null);
  localStorage.removeItem('gapi_token');
  toggleSettings();
  showScreen(authScreen);
}

export function silentReauth() {
  if (reauthResolve) reauthResolve(false);
  return new Promise((resolve) => {
    reauthResolve = resolve;
    tokenClient.requestAccessToken({ prompt: '' });
    setTimeout(() => {
      if (reauthResolve === resolve) {
        reauthResolve = null;
        resolve(false);
      }
    }, 10000);
  });
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
