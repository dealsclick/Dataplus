const assert = require('node:assert/strict')
const {
  normalizeOutboundSessionCalendar,
  outboundOperatingDate,
  outboundSessionMetadata,
} = require('../lib/outbound-session-calendar')

const weekendClosed = normalizeOutboundSessionCalendar({
  outboundSessionTimezone: 'America/New_York',
  outboundSessionRolloverTime: '00:00',
  outboundSessionClosedWeekdays: [0, 6],
})

assert.equal(outboundOperatingDate(new Date('2026-11-28T17:00:00Z'), weekendClosed), '2026-11-30')
assert.equal(outboundOperatingDate(new Date('2026-11-29T17:00:00Z'), weekendClosed), '2026-11-30')
assert.equal(outboundOperatingDate(new Date('2026-11-30T23:59:00Z'), weekendClosed), '2026-11-30')
assert.equal(outboundOperatingDate(new Date('2026-12-01T17:00:00Z'), weekendClosed), '2026-12-01')

const everyDay = normalizeOutboundSessionCalendar({ outboundSessionClosedWeekdays: [] })
assert.equal(outboundOperatingDate(new Date('2026-11-28T17:00:00Z'), everyDay), '2026-11-28')

const twoAm = normalizeOutboundSessionCalendar({
  outboundSessionTimezone: 'America/New_York',
  outboundSessionRolloverTime: '02:00',
  outboundSessionClosedWeekdays: [0, 6],
})
assert.equal(outboundOperatingDate(new Date('2026-11-28T06:00:00Z'), twoAm), '2026-11-27')
assert.equal(outboundOperatingDate(new Date('2026-11-28T08:00:00Z'), twoAm), '2026-11-30')

const metadata = outboundSessionMetadata(
  { started_at: new Date('2026-11-28T17:00:00Z') },
  weekendClosed,
  new Date('2026-11-30T17:00:00Z'),
)
assert.equal(metadata.operatingDate, '2026-11-30')
assert.equal(metadata.isCurrentOperatingSession, true)
assert.deepEqual(metadata.sessionClosedWeekdays, [0, 6])

const invalidAllClosed = normalizeOutboundSessionCalendar({ outboundSessionClosedWeekdays: [0, 1, 2, 3, 4, 5, 6] })
assert.deepEqual(invalidAllClosed.closedWeekdays, [0, 6])

console.log('outbound operating calendar tests passed')
