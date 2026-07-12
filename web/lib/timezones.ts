const FALLBACK_TIMEZONES = [
  'Pacific/Honolulu', 'America/Anchorage', 'America/Los_Angeles', 'America/Denver',
  'America/Chicago', 'America/New_York', 'America/Sao_Paulo', 'Atlantic/Reykjavik',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'Africa/Cairo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Bangkok',
  'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo', 'Asia/Seoul',
  'Australia/Sydney', 'Pacific/Auckland', 'UTC',
];

export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function listTimezones(): string[] {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch { /* older browsers */ }
  return FALLBACK_TIMEZONES;
}

export function getTimezoneOffsetMinutes(tz: string, at = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(at);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
    const utcMinutes = at.getUTCHours() * 60 + at.getUTCMinutes();
    const localMinutes = hour * 60 + minute;
    let diff = localMinutes - utcMinutes;
    const dayDiff = at.getUTCDate() - Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, day: 'numeric' }).format(at),
    );
    if (dayDiff > 0) diff += 24 * 60;
    if (dayDiff < 0) diff -= 24 * 60;
    return diff;
  } catch {
    return 0;
  }
}

export function formatTimezoneOffset(tz: string): string {
  const mins = getTimezoneOffsetMinutes(tz);
  const sign = mins >= 0 ? '+' : '-';
  const abs = Math.abs(mins);
  const h = String(Math.floor(abs / 60)).padStart(2, '0');
  const m = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${h}:${m}`;
}

export function formatTimezoneLabel(tz: string): string {
  const city = tz.split('/').pop()?.replace(/_/g, ' ') || tz;
  return `${city} (${formatTimezoneOffset(tz)})`;
}

export function sortTimezones(zones: string[], preferred?: string): string[] {
  const unique = [...new Set(zones)];
  unique.sort((a, b) => {
    const off = getTimezoneOffsetMinutes(a) - getTimezoneOffsetMinutes(b);
    if (off !== 0) return off;
    return a.localeCompare(b);
  });
  if (preferred && unique.includes(preferred)) {
    return [preferred, ...unique.filter(z => z !== preferred)];
  }
  return unique;
}

export function filterTimezones(zones: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return zones;
  return zones.filter(tz => {
    const city = tz.split('/').pop()?.replace(/_/g, ' ').toLowerCase() || '';
    return tz.toLowerCase().includes(q) || city.includes(q);
  });
}
