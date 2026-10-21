// Business dates are Cairo calendar dates; the database stores timestamptz in UTC.
// For timestamptz columns filter with .gte(start).lt(endExclusive); for DATE columns use the YYYY-MM-DD strings directly.

export const APP_TIME_ZONE = 'Africa/Cairo'

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
})

function zonedParts(date: Date): Record<string, string> {
  const parts: Record<string, string> = {}
  for (const { type, value } of partsFormatter.formatToParts(date)) parts[type] = value
  return parts
}

/** Minutes the Cairo wall clock is ahead of UTC at the given instant (120 in winter, 180 in summer). */
function offsetMinutes(date: Date): number {
  const p = zonedParts(date)
  const wallAsUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second)
  return Math.round((wallAsUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

/** Cairo calendar date (YYYY-MM-DD) of an instant. */
export function toLocalDate(value: Date | string | number = new Date()): string {
  const p = zonedParts(new Date(value))
  return `${p.year}-${p.month}-${p.day}`
}

/** Today's Cairo date (YYYY-MM-DD). Use instead of new Date().toISOString().split('T')[0], which is the UTC date. */
export function todayLocal(): string {
  return toLocalDate(new Date())
}

/** First day of the current Cairo month (YYYY-MM-01). */
export function monthStartLocal(): string {
  return `${todayLocal().slice(0, 8)}01`
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** UTC ISO timestamp of 00:00 Cairo time on a YYYY-MM-DD date. */
export function localDayStartISO(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const midnightAsUtc = Date.UTC(y, m - 1, d)
  let instant = midnightAsUtc - offsetMinutes(new Date(midnightAsUtc)) * 60000
  instant = midnightAsUtc - offsetMinutes(new Date(instant)) * 60000 // second pass settles DST change days
  return new Date(instant).toISOString()
}

/** UTC ISO timestamp of 00:00 Cairo time on the day AFTER `date`: an exclusive upper bound for `.lt()`. */
export function localDayEndExclusiveISO(date: string): string {
  return localDayStartISO(addDays(date, 1))
}

/** Inclusive Cairo date range -> [start, endExclusive) bounds for timestamptz columns. */
export function localDateRangeISO(from: string, to: string): { start: string; endExclusive: string } {
  return { start: localDayStartISO(from), endExclusive: localDayEndExclusiveISO(to) }
}
