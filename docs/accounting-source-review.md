# Accounting source review

The Accounting order ledger and its Review and post dialog show advisory checks
on captured source observations. The latest appended version of each source key
is used. Return views include only that return's observations.

- Unavailable or unverified amounts are not zero.
- Pending amounts require source confirmation.
- Estimated amounts remain distinct from reported amounts.
- Reference-only observations retain that designation.
- A reported zero is valid. Reported does not mean reconciled to settlement.
- No observations means Not captured, not ready or complete.

These checks do not change order queues, start imports, post journals, or call
channel APIs. They describe saved snapshots, not live marketplace state. Existing
server-side posting validation remains authoritative and rechecks sources when
posting. Advisory order-level cost gaps do not prevent a legitimate revenue-only
journal supported by other evidence.

Verification: `node --test --test-isolation=none scripts/test-accounting-readiness.mjs`
