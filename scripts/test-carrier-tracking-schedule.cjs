const assert = require("node:assert/strict")

const { dailyScheduleKey, localDateTimeParts } = require("../lib/carrier-tracking-schedule")

assert.deepEqual(localDateTimeParts(new Date("2026-10-31T02:59:00.000Z")), {
  date: "2026-10-30",
  time: "22:59",
})
assert.equal(dailyScheduleKey(new Date("2026-10-31T02:59:00.000Z"), { prefix: "carrier-tracking-nightly" }), "")
assert.equal(dailyScheduleKey(new Date("2026-10-31T03:00:00.000Z"), { prefix: "carrier-tracking-nightly" }), "carrier-tracking-nightly:2026-10-30")
assert.equal(dailyScheduleKey(new Date("2027-01-02T04:00:00.000Z"), { prefix: "carrier-tracking-nightly" }), "carrier-tracking-nightly:2027-01-01")
assert.equal(dailyScheduleKey(new Date("2027-01-02T05:00:00.000Z"), { prefix: "carrier-tracking-nightly" }), "")

console.log("Carrier tracking schedule tests passed")
