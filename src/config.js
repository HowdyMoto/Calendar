// ── Configuration ───────────────────────────────────────
// Replace with your Google Cloud OAuth2 Client ID
// Instructions: https://console.cloud.google.com/apis/credentials
export const APP_VERSION = __APP_VERSION__;
export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
export const WORKER_URL = import.meta.env.VITE_WORKER_URL || 'https://nudge-auth.wrightbagwell.workers.dev';
export const SCOPES = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/contacts.readonly https://www.googleapis.com/auth/contacts.other.readonly https://www.googleapis.com/auth/tasks.readonly https://www.googleapis.com/auth/userinfo.profile';
export const DISCOVERY_DOCS = [
  'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest',
  'https://www.googleapis.com/discovery/v1/apis/people/v1/rest',
  'https://www.googleapis.com/discovery/v1/apis/tasks/v1/rest',
];
export const DEMO_MODE = !CLIENT_ID || CLIENT_ID.startsWith('__');
