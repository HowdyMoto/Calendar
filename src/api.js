// ── Google Calendar & Tasks API ──────────────────────────

import {
  events, showTasks, calendarMeta, photoCache,
  setEvents, setCalendarMeta, setLastStructureKey,
} from './state.js';
import { renderEvents } from './render.js';
import { showScreen, authScreen, showReauthBanner, hideReauthBanner } from './ui.js';
import { silentReauth } from './auth.js';
import { DEMO_MODE } from './config.js';

// ── Fetch profile photos via People API ──────────────────

let selfPromise = null;

function findSelfEmail() {
  for (const ev of events) {
    if (ev.organizer?.self && ev.organizer?.email) return ev.organizer.email.toLowerCase();
    const selfAttendee = ev.attendees?.find(a => a.self);
    if (selfAttendee?.email) return selfAttendee.email.toLowerCase();
  }
  return null;
}

async function fetchSelfPhoto() {
  if (selfPromise) return selfPromise;
  const selfEmail = findSelfEmail();
  if (!selfEmail) return;
  selfPromise = (async () => {
    try {
      const resp = await gapi.client.people.people.get({
        resourceName: 'people/me',
        personFields: 'photos',
      });
      const photo = resp.result.photos?.find(p => !p.default)?.url;
      if (photo) photoCache[selfEmail] = photo;
    } catch (e) {
      console.warn('[photos] self lookup failed:', e);
    }
  })();
  return selfPromise;
}

export async function fetchPhotos(emails) {
  if (!gapi.client.people) return;
  await fetchSelfPhoto();
  const uncached = emails.filter(e => e && !(e in photoCache));
  if (uncached.length === 0) {
    setLastStructureKey('');
    renderEvents();
    return;
  }

  uncached.forEach(e => { photoCache[e] = ''; });

  await fetchPhotosFromConnections(uncached);

  let missing = uncached.filter(e => !photoCache[e]);
  if (missing.length) await fetchPhotosFromOtherContacts(missing);

  const found = uncached.filter(e => photoCache[e]);
  const notFound = uncached.filter(e => !photoCache[e]);
  if (found.length) console.log('[photos] found:', found);
  if (notFound.length) console.log('[photos] not found:', notFound);

  setLastStructureKey('');
  renderEvents();
}

async function fetchPhotosFromConnections(emails) {
  try {
    let pageToken = '';
    const emailSet = new Set(emails.map(e => e.toLowerCase()));
    do {
      const resp = await gapi.client.people.people.connections.list({
        resourceName: 'people/me',
        personFields: 'emailAddresses,photos',
        pageSize: 1000,
        pageToken: pageToken || undefined,
      });
      const connections = resp.result.connections || [];
      for (const c of connections) {
        const cEmails = (c.emailAddresses || []).map(e => e.value.toLowerCase());
        const match = cEmails.find(e => emailSet.has(e));
        if (match) {
          const photo = c.photos?.find(p => !p.default)?.url;
          if (photo) photoCache[match] = photo;
          emailSet.delete(match);
        }
      }
      pageToken = resp.result.nextPageToken || '';
    } while (pageToken && emailSet.size > 0);
  } catch (e) {
    console.warn('[photos] connections lookup failed:', e);
  }
}

async function fetchPhotosFromOtherContacts(emails) {
  try {
    let pageToken = '';
    const emailSet = new Set(emails.map(e => e.toLowerCase()));
    do {
      const resp = await gapi.client.people.otherContacts.list({
        readMask: 'emailAddresses,photos',
        pageSize: 100,
        pageToken: pageToken || undefined,
      });
      const contacts = resp.result.otherContacts || [];
      for (const c of contacts) {
        const cEmails = (c.emailAddresses || []).map(e => e.value.toLowerCase());
        const match = cEmails.find(e => emailSet.has(e));
        if (match) {
          const photo = c.photos?.find(p => !p.default)?.url;
          if (photo) photoCache[match] = photo;
          emailSet.delete(match);
        }
      }
      pageToken = resp.result.nextPageToken || '';
    } while (pageToken && emailSet.size > 0);
  } catch (e) {
    console.warn('[photos] otherContacts lookup failed:', e);
  }
}

// ── Fetch Events (from all visible calendars) ───────────

function pickAvatarPerson(event) {
  const organizer = event.organizer || {};
  const attendees = event.attendees || [];
  const iAmOrganizer = organizer.self || attendees.some(a => a.self && a.organizer);

  if (!iAmOrganizer || attendees.length === 0) {
    return organizer;
  }

  const others = attendees.filter(a => !a.self && !a.resource);
  if (others.length === 0) return organizer;

  const statusScore = { accepted: 4, tentative: 3, needsAction: 2, declined: 0 };
  others.sort((a, b) => {
    const sa = statusScore[a.responseStatus] || 1;
    const sb = statusScore[b.responseStatus] || 1;
    if (sa !== sb) return sb - sa;
    if (a.displayName && !b.displayName) return -1;
    if (!a.displayName && b.displayName) return 1;
    return 0;
  });

  return others[0];
}

export { pickAvatarPerson };

export async function fetchEvents(isRetry) {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    const calList = await gapi.client.calendar.calendarList.list();
    const calendars = (calList.result.items || []).filter(c => c.selected !== false);

    calendars.forEach(c => {
      calendarMeta[c.id] = { backgroundColor: c.backgroundColor };
    });

    const fetches = calendars.map(c =>
      gapi.client.calendar.events.list({
        calendarId: c.id,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      }).then(resp => {
        return (resp.result.items || []).map(ev => ({
          ...ev,
          _calendarId: c.id,
        }));
      }).catch(() => [])
    );

    const results = await Promise.all(fetches);
    const seen = new Set();
    setEvents(results.flat()
      .filter(e => {
        if (e.status === 'cancelled') return false;
        const uid = e.iCalUID;
        if (uid && seen.has(uid)) return false;
        if (uid) seen.add(uid);
        return true;
      })
      .sort((a, b) => {
        const aTime = a.start.dateTime || a.start.date || '';
        const bTime = b.start.dateTime || b.start.date || '';
        return aTime.localeCompare(bTime);
      }));

    setLastStructureKey('');
    renderEvents();
    hideReauthBanner();

    const emails = events.map(e => pickAvatarPerson(e).email).filter(Boolean);
    if (emails.length) fetchPhotos([...new Set(emails)]);
  } catch (err) {
    console.error('Failed to fetch events:', err);
    if (err.status === 401) {
      const ok = await silentReauth();
      if (ok) return fetchEvents(true);
      // Silent reauth failed (common on iOS PWA). Keep the stored token and
      // whatever events we last rendered; prompt the user to re-auth with one tap.
      showReauthBanner();
    }
  }
}

// ── Fetch Tomorrow's Events (one-shot, doesn't mutate state) ─────

export async function fetchTomorrowEvents() {
  const now = new Date();
  const startOfTomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const endOfTomorrow = new Date(startOfTomorrow);
  endOfTomorrow.setDate(endOfTomorrow.getDate() + 1);

  try {
    const calList = await gapi.client.calendar.calendarList.list();
    const calendars = (calList.result.items || []).filter(c => c.selected !== false);

    const fetches = calendars.map(c =>
      gapi.client.calendar.events.list({
        calendarId: c.id,
        timeMin: startOfTomorrow.toISOString(),
        timeMax: endOfTomorrow.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 50,
      }).then(resp => (resp.result.items || []).map(ev => ({ ...ev, _calendarId: c.id })))
       .catch(() => [])
    );

    const results = await Promise.all(fetches);
    const seen = new Set();
    return results.flat()
      .filter(e => {
        if (e.status === 'cancelled') return false;
        const uid = e.iCalUID;
        if (uid && seen.has(uid)) return false;
        if (uid) seen.add(uid);
        return true;
      })
      .sort((a, b) => {
        const aTime = a.start.dateTime || a.start.date || '';
        const bTime = b.start.dateTime || b.start.date || '';
        return aTime.localeCompare(bTime);
      });
  } catch (err) {
    console.warn('Failed to fetch tomorrow events:', err);
    return [];
  }
}

// ── Fetch Tasks ─────────────────────────────────────────

export async function fetchTasks() {
  if (!showTasks || !gapi.client.tasks) return;
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  try {
    const listsResp = await gapi.client.tasks.tasklists.list({ maxResults: 100 });
    const taskLists = listsResp.result.items || [];

    const fetches = taskLists.map(tl =>
      gapi.client.tasks.tasks.list({
        tasklist: tl.id,
        dueMin: startOfDay.toISOString(),
        dueMax: endOfDay.toISOString(),
        showCompleted: false,
        showHidden: false,
        maxResults: 100,
      }).then(resp => (resp.result.items || []).map(t => ({
        ...t,
        _taskListName: tl.title,
      }))).catch(() => [])
    );

    const results = await Promise.all(fetches);
    const tasks = results.flat().filter(t => t.status !== 'completed');

    const taskEvents = tasks.map(t => ({
      summary: t.title || '(No title)',
      start: { date: t.due ? t.due.split('T')[0] : now.toISOString().split('T')[0] },
      end: { date: t.due ? t.due.split('T')[0] : now.toISOString().split('T')[0] },
      _isTask: true,
      _taskListName: t._taskListName,
      iCalUID: `task-${t.id}`,
    }));

    setEvents(events.filter(e => !e._isTask).concat(taskEvents)
      .sort((a, b) => {
        const aTime = a.start.dateTime || a.start.date || '';
        const bTime = b.start.dateTime || b.start.date || '';
        return aTime.localeCompare(bTime);
      }));

    setLastStructureKey('');
    renderEvents();
  } catch (err) {
    console.warn('Failed to fetch tasks:', err);
  }
}
