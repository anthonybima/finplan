/**
 * Monthly account-update reminder: by default the 1st Sunday of every month.
 * Pure date logic (local time) + calendar (.ics) export so the phone reminds you even when FinPlan is closed.
 */
import type { AppData, MonthlyReminder, Settings } from './types';
import { toISO } from './format';

export type { MonthlyReminder };

export const DEFAULT_MONTHLY: MonthlyReminder = { enabled: true, week: 1, day: 0, time: '09:00', notify: true };
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEK_NAMES: Record<number, string> = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 5: 'Last' };

export const monthlyOf = (s: Settings): MonthlyReminder => ({ ...DEFAULT_MONTHLY, ...(s.monthlyUpdate || {}) });

/** Date of the nth weekday in a month (week 5 = last). month: 0-11. */
export function nthWeekday(year: number, month: number, week: number, day: number): Date {
  if (week >= 5) {
    const last = new Date(year, month + 1, 0);
    return new Date(year, month, last.getDate() - ((last.getDay() - day + 7) % 7));
  }
  const first = new Date(year, month, 1);
  return new Date(year, month, 1 + ((day - first.getDay() + 7) % 7) + (week - 1) * 7);
}

export type ReminderStatus = 'off' | 'upcoming' | 'due' | 'overdue' | 'done' | 'snoozed';
export interface ReminderState {
  status: ReminderStatus;
  month: string;          // "YYYY-MM" this cycle
  dueDate: string;        // this month's reminder day (ISO)
  nextDate: string;       // next reminder day that is not done yet
  daysLate: number;       // days since the due date (0 on the day)
  staleAccounts: number;  // manual accounts not updated since the due date
}

/** Accounts the user updates by hand (synced investment accounts update themselves). */
export const manualAccounts = (d: AppData) => d.accounts.filter((a) => !a.synced);

export function reminderState(d: AppData, now = new Date()): ReminderState {
  const r = monthlyOf(d.settings);
  const today = toISO(now);
  const y = now.getFullYear(), m = now.getMonth();
  const due = toISO(nthWeekday(y, m, r.week, r.day));
  const month = today.slice(0, 7);
  const nextMonth = toISO(nthWeekday(m === 11 ? y + 1 : y, (m + 1) % 12, r.week, r.day));
  const stale = manualAccounts(d).filter((a) => (a.updatedAt || '') < due).length;
  const base = { month, dueDate: due, daysLate: 0, staleAccounts: stale };
  if (!r.enabled) return { ...base, status: 'off', nextDate: today < due ? due : nextMonth };
  if (today < due) return { ...base, status: 'upcoming', nextDate: due };
  // on/after this month's day
  const done = r.doneMonth === month || (manualAccounts(d).length > 0 && stale === 0);
  if (done) return { ...base, status: 'done', nextDate: nextMonth };
  const daysLate = Math.round((new Date(today + 'T00:00:00').getTime() - new Date(due + 'T00:00:00').getTime()) / 864e5);
  if (r.snoozeUntil && today < r.snoozeUntil) return { ...base, status: 'snoozed', nextDate: due, daysLate };
  return { ...base, status: daysLate === 0 ? 'due' : 'overdue', nextDate: due, daysLate };
}

export const reminderLabel = (r: MonthlyReminder) => `${WEEK_NAMES[r.week]} ${DAY_NAMES[r.day]} of every month`;

/* ---------------------------------------------------------------- calendar export */

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

/** A repeating calendar event (RFC 5545) with an alert, e.g. RRULE:FREQ=MONTHLY;BYDAY=1SU. */
export function reminderICS(r: MonthlyReminder, now = new Date(), appUrl = ''): string {
  const [hh, mm] = (r.time || '09:00').split(':').map((x) => parseInt(x, 10) || 0);
  let first = nthWeekday(now.getFullYear(), now.getMonth(), r.week, r.day);
  if (toISO(first) < toISO(now)) first = nthWeekday(now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear(), (now.getMonth() + 1) % 12, r.week, r.day);
  const p = (n: number) => String(n).padStart(2, '0');
  const local = (d: Date, h: number, mi: number) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(h)}${p(mi)}00`;
  const end = new Date(first.getTime()); const endMin = hh * 60 + mm + 30;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const desc = `Open FinPlan and update your account balances (banks, e-wallets, cash, investments, debts), then sync connected apps or Smart scan your portfolio.${appUrl ? `\n${appUrl}` : ''}`;
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FinPlan//Monthly account update//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:finplan-monthly-update-${BYDAY[r.day]}${r.week}@finplan.local`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${local(first, hh, mm)}`,
    `DTEND:${local(end, Math.floor(endMin / 60) % 24, endMin % 60)}`,
    `RRULE:FREQ=MONTHLY;BYDAY=${r.week >= 5 ? '-1' : r.week}${BYDAY[r.day]}`,
    `SUMMARY:${icsEsc('FinPlan: update your accounts')}`,
    `DESCRIPTION:${icsEsc(desc)}`,
    ...(appUrl ? [`URL:${appUrl}`] : []),
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc('FinPlan: update your accounts')}`, 'TRIGGER:PT0M', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
}

/* ---------------------------------------------------------------- device notification */

export function notificationsSupported(): boolean {
  try { return typeof Notification !== 'undefined' && window.isSecureContext !== false; } catch { return false; }
}
export async function askNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  try { return await Notification.requestPermission(); } catch { return 'denied'; }
}
/** Shows a system notification when allowed. Returns true if shown. */
export async function showReminderNotification(body: string, onClick?: () => void): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined);
    if (reg?.showNotification) { await reg.showNotification('FinPlan', { body, tag: 'finplan-monthly-update', icon: 'icon.svg' }); return true; }
    const n = new Notification('FinPlan', { body, tag: 'finplan-monthly-update' });
    n.onclick = () => { window.focus(); onClick?.(); n.close(); };
    return true;
  } catch { return false; }
}
