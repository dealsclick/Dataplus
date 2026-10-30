function localDateTimeParts(date = new Date(), timeZone = "America/New_York") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function dailyScheduleKey(date = new Date(), options = {}) {
  const timeZone = String(options.timeZone || "America/New_York");
  const hour = Math.max(0, Math.min(23, Number(options.hour ?? 23) || 0));
  const minute = Math.max(0, Math.min(59, Number(options.minute ?? 0) || 0));
  const prefix = String(options.prefix || "daily").trim() || "daily";
  const local = localDateTimeParts(date, timeZone);
  const scheduledTime = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  return local.time >= scheduledTime ? `${prefix}:${local.date}` : "";
}

module.exports = { dailyScheduleKey, localDateTimeParts };
