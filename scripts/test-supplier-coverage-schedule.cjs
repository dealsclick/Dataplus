const assert = require("node:assert/strict");
const { supplierCoverageScheduleSlot } = require("../lib/supplier-coverage-schedule");

const options = { timeZone: "America/New_York", day: 5, hour: 20 };

assert.equal(
  supplierCoverageScheduleSlot(new Date("2026-11-20T23:59:00Z"), options),
  null,
  "Friday reconciliation must not start before 8 PM Eastern"
);
assert.deepEqual(
  supplierCoverageScheduleSlot(new Date("2026-11-21T01:00:00Z"), options),
  {
    key: "supplier-coverage-weekly:2026-11-20",
    dateKey: "2026-11-20",
    timeZone: "America/New_York",
    scheduledDay: 5,
    scheduledHour: 20
  },
  "Friday reconciliation must become due at 8 PM Eastern"
);
assert.equal(
  supplierCoverageScheduleSlot(new Date("2026-11-21T14:00:00Z"), options),
  null,
  "the full reconciliation must not become a daily weekend task"
);

console.log("Supplier coverage Friday schedule checks passed.");
