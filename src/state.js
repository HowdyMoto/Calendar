// ── Shared mutable state ────────────────────────────────
// Centralized so modules can read/write without circular imports.

export let events = [];
export let updateTimer;
export let refreshTimer;
export let showTasks = localStorage.getItem('show_tasks') !== 'false';
export let calendarColors = {};
export let calendarMeta = {};
export const photoCache = {};
export let lastStructureKey = '';
export let lastGutterKey = '';

export let PX_PER_MIN = 4;
export const MIN_CARD_HEIGHT = 40;
export let dayStartHour = 0;
export let dayEndHour = 24;

export const firedMilestones = new Map();
export const dismissedEvents = new Set();
export const previousStates = new Set();
export const ONE_SHOT_ANIM_CLASSES = ['throb-small', 'throb-medium', 'throb-large', 'meeting-done'];

// Setters for primitives (can't reassign exports from outside)
export function setEvents(e) { events = e; }
export function setUpdateTimer(t) { updateTimer = t; }
export function setRefreshTimer(t) { refreshTimer = t; }
export function setShowTasks(v) { showTasks = v; }
export function setCalendarColors(c) { calendarColors = c; }
export function setCalendarMeta(c) { calendarMeta = c; }
export function setLastStructureKey(k) { lastStructureKey = k; }
export function setLastGutterKey(k) { lastGutterKey = k; }
export function setPxPerMin(v) { PX_PER_MIN = v; }
export function setDayStartHour(h) { dayStartHour = h; }
export function setDayEndHour(h) { dayEndHour = h; }
