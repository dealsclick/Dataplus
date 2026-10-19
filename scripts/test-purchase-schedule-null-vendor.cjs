const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync(require.resolve("../server"), "utf8");
const start = source.indexOf("function localDateTimeParts(");
const end = source.indexOf("function previewPurchaseScheduleWindows(", start);
assert.ok(start >= 0 && end > start, "purchase scheduling helpers must remain available");
const context = vm.createContext({ Date, Intl, Set, String, Number, Boolean, Math, console });
vm.runInContext(`${source.slice(start, end)}\nthis.nextPurchaseScheduleWindow = nextPurchaseScheduleWindow;`, context);
const { nextPurchaseScheduleWindow } = context;

const result = nextPurchaseScheduleWindow(new Date("2026-10-19T12:00:00.000Z"), null, {
  timezone: "America/New_York",
  cutoffTime: "15:00",
  skipWeekends: true
});

assert.equal(result.scheduleMode, "daily");
assert.equal(result.cutoffTimezone, "America/New_York");
assert.match(result.poolDate, /^\d{4}-\d{2}-\d{2}$/);
assert.match(result.expectedDeliveryDate, /^\d{4}-\d{2}-\d{2}$/);

console.log("Null-vendor purchase scheduling regression test passed.");
