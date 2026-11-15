const DEFAULT_TIME_ZONE = "America/New_York";
const DEFAULT_DAY = 5;
const DEFAULT_HOUR = 20;

function localDateParts(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value || "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  return {
    year,
    month,
    day,
    hour: Number(value("hour")),
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    dateKey: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  };
}

function supplierCoverageScheduleSlot(date = new Date(), options = {}) {
  const timeZone = String(options.timeZone || DEFAULT_TIME_ZONE);
  const scheduledDay = Math.max(0, Math.min(6, Number(options.day ?? DEFAULT_DAY)));
  const scheduledHour = Math.max(0, Math.min(23, Number(options.hour ?? DEFAULT_HOUR)));
  const catchUpDays = Math.max(0, Math.min(2, Number(options.catchUpDays ?? 0)));
  const local = localDateParts(date, timeZone);
  const daysAfterSchedule = (local.weekday - scheduledDay + 7) % 7;
  if (daysAfterSchedule > catchUpDays) return null;
  if (daysAfterSchedule === 0 && local.hour < scheduledHour) return null;
  const scheduledDate = new Date(Date.UTC(local.year, local.month - 1, local.day - daysAfterSchedule));
  const dateKey = scheduledDate.toISOString().slice(0, 10);
  return {
    key: `supplier-coverage-weekly:${dateKey}`,
    dateKey,
    timeZone,
    scheduledDay,
    scheduledHour
  };
}

module.exports = {
  DEFAULT_DAY,
  DEFAULT_HOUR,
  DEFAULT_TIME_ZONE,
  localDateParts,
  supplierCoverageScheduleSlot
};
