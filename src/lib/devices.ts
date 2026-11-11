/**
 * Devices of a FinPlan account (stored in the account's own data, so every device sees the same list through sync):
 * each phone / tablet / computer that opens the account, by its Browser ID (FP-XXXX-XXXX).
 *   allowed  – can use the account
 *   pending  – joined while "new devices need approval" was on; waits until an allowed device taps Allow
 *   removed  – removed by an allowed device: on its next sync it erases this account from itself and signs out
 * The real protection is the password + encryption; this list is the account's record and control of where it is open.
 */
import type { AppData } from './types';

export type DeviceKind = 'phone' | 'tablet' | 'computer';
export type DeviceStatus = 'allowed' | 'pending' | 'removed';
export interface DeviceRec {
  id: string;          // per-install id (Browser ID is derived from it)
  short: string;       // FP-XXXX-XXXX
  name: string;        // "Phone 1", editable
  kind: DeviceKind;
  platform: string;    // "Chrome on Android · in Claude"
  firstSeen: string;   // ISO
  lastSeen: string;    // ISO, updated at most once a day
  status: DeviceStatus;
  statusAt: string;    // when status / name last changed (wins on merge)
  statusBy?: string;   // Browser ID of the device that changed it
}
export interface ThisDevice { id: string; short: string; browser: string; os: string; platform: string }

export function deviceKind(os: string, ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): DeviceKind {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && (navigator as any).maxTouchPoints > 1)) return 'tablet';
  if (/iPhone|Android|Mobile/i.test(ua) || /iOS|Android/i.test(os)) return 'phone';
  return 'computer';
}
const KIND_NAME: Record<DeviceKind, string> = { phone: 'Phone', tablet: 'Tablet', computer: 'Computer' };
export const kindLabel = (k: DeviceKind) => KIND_NAME[k];
const inClaude = () => { try { return !!(window as any).claude; } catch { return false; } };
export const platformOf = (t: ThisDevice) => `${t.browser} on ${t.os}${inClaude() ? ' · in Claude' : t.platform !== 'Web browser' ? ` · ${t.platform}` : ''}`;
const day = (iso?: string) => (iso || '').slice(0, 10);

/** Add this device to the account's list, or refresh it (at most once a day). Returns null when nothing changed. */
export function registerDevice(d: AppData, t: ThisDevice, now = new Date()): AppData | null {
  const list = d.devices || [];
  const at = now.toISOString(); const platform = platformOf(t);
  const me = list.find((x) => x.id === t.id);
  if (!me) {
    const kind = deviceKind(t.os);
    const n = list.filter((x) => x.kind === kind).length + 1;
    const needApproval = !!d.settings.devicesNeedApproval && list.some((x) => x.status === 'allowed');
    const rec: DeviceRec = { id: t.id, short: t.short, name: `${KIND_NAME[kind]} ${n}`, kind, platform, firstSeen: at, lastSeen: at, status: needApproval ? 'pending' : 'allowed', statusAt: at };
    return { ...d, devices: [...list, rec] };
  }
  if (day(me.lastSeen) === day(at) && me.platform === platform && me.short === t.short) return null;
  return { ...d, devices: list.map((x) => (x.id === t.id ? { ...x, lastSeen: at, platform, short: t.short } : x)) };
}

export function setDeviceStatus(d: AppData, id: string, status: DeviceStatus, by: string): AppData {
  const at = new Date().toISOString();
  return { ...d, devices: (d.devices || []).map((x) => (x.id === id ? { ...x, status, statusAt: at, statusBy: by } : x)) };
}
export function renameDeviceRec(d: AppData, id: string, name: string, by: string): AppData {
  const at = new Date().toISOString(); const n = name.trim().slice(0, 40);
  return n ? { ...d, devices: (d.devices || []).map((x) => (x.id === id ? { ...x, name: n, statusAt: at, statusBy: by } : x)) } : d;
}
export function forgetDevice(d: AppData, id: string): AppData { return { ...d, devices: (d.devices || []).filter((x) => x.id !== id) }; }

/** Merge two device lists: status/name from the newer change, lastSeen = latest. */
export function mergeDevices(a: DeviceRec[] = [], b: DeviceRec[] = []): DeviceRec[] {
  const m = new Map<string, DeviceRec>(b.map((x) => [x.id, x]));
  for (const x of a) {
    const y = m.get(x.id);
    if (!y) { m.set(x.id, x); continue; }
    const base = (x.statusAt || '') >= (y.statusAt || '') ? x : y;
    m.set(x.id, { ...base, lastSeen: (x.lastSeen || '') > (y.lastSeen || '') ? x.lastSeen : y.lastSeen, firstSeen: (x.firstSeen || '') < (y.firstSeen || '') ? x.firstSeen : y.firstSeen });
  }
  return [...m.values()].sort((p, q) => (p.firstSeen || '').localeCompare(q.firstSeen || ''));
}

export const myDevice = (d: AppData | null, id?: string) => (d && id ? (d.devices || []).find((x) => x.id === id) : undefined);
