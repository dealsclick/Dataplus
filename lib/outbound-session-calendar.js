const DEFAULT_OUTBOUND_SESSION_CALENDAR = Object.freeze({
  timeZone: "America/New_York",
  rolloverTime: "00:00",
  closedWeekdays: Object.freeze([0, 6]),
});

function validTimeZone(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return DEFAULT_OUTBOUND_SESSION_CALENDAR.timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_OUTBOUND_SESSION_CALENDAR.timeZone;
  }
}

function normalizeClosedWeekdays(value) {
  const source = Array.isArray(value) ? value : DEFAULT_OUTBOUND_SESSION_CALENDAR.closedWeekdays;
  const days = [...new Set(source.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((left, right) => left - right);
  return days.length < 7 ? days : [...DEFAULT_OUTBOUND_SESSION_CALENDAR.closedWeekdays];
}

function normalizeOutboundSessionCalendar(settings = {}) {
  const suppliedRolloverTime = settings.outboundSessionRolloverTime || settings.rolloverTime;
  const rolloverTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(suppliedRolloverTime || ""))
    ? String(suppliedRolloverTime)
    : DEFAULT_OUTBOUND_SESSION_CALENDAR.rolloverTime;
  return {
    timeZone: validTimeZone(settings.outboundSessionTimezone || settings.timeZone || settings.organizationTimezone),
    rolloverTime,
    closedWeekdays: normalizeClosedWeekdays(settings.outboundSessionClosedWeekdays ?? settings.closedWeekdays),
  };
}

function zonedDateTimeParts(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour || 0) * 60 + Number(values.minute || 0),
  };
}

function addCalendarDays(dateKey, amount) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return date.toISOString().slice(0, 10);
}

function weekdayForDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function nextOpenDate(dateKey, closedWeekdays) {
  const closed = new Set(closedWeekdays);
  let candidate = dateKey;
  for (let attempt = 0; attempt < 7 && closed.has(weekdayForDateKey(candidate)); attempt += 1) {
    candidate = addCalendarDays(candidate, 1);
  }
  return candidate;
}

function outboundOperatingDate(value = new Date(), settings = {}) {
  const calendar = normalizeOutboundSessionCalendar(settings);
  const local = zonedDateTimeParts(value, calendar.timeZone);
  if (!local) return "";
  const [rolloverHour, rolloverMinute] = calendar.rolloverTime.split(":").map(Number);
  const rolloverMinutes = rolloverHour * 60 + rolloverMinute;
  const baseDate = local.minutes < rolloverMinutes ? addCalendarDays(local.date, -1) : local.date;
  return nextOpenDate(baseDate, calendar.closedWeekdays);
}

function outboundSessionMetadata(session = {}, settings = {}, now = new Date()) {
  const calendar = normalizeOutboundSessionCalendar(settings);
  const operatingDate = outboundOperatingDate(session.started_at || session.startedAt, calendar);
  const currentOperatingDate = outboundOperatingDate(now, calendar);
  return {
    operatingDate,
    currentOperatingDate,
    isCurrentOperatingSession: Boolean(operatingDate && operatingDate === currentOperatingDate),
    sessionTimeZone: calendar.timeZone,
    sessionRolloverTime: calendar.rolloverTime,
    sessionClosedWeekdays: calendar.closedWeekdays,
  };
}

module.exports = {
  DEFAULT_OUTBOUND_SESSION_CALENDAR,
  normalizeOutboundSessionCalendar,
  outboundOperatingDate,
  outboundSessionMetadata,
};
