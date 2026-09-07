# Return receiving

Returns now includes an exact-reference lookup for local return ID/number, channel
return ID, local order ID/number, channel order ID, and return tracking number.
Keyboard-wedge scanners can enter a reference and Enter. No camera scanner is
added. Closed channel cases remain eligible for physical receipt. Multiple matches
are shown separately; the operator chooses a return. Up to 50 matches are shown.

The receiving dialog records cumulative received quantities, physical warehouse,
bin/location, condition, inspection notes, proposed disposition and up to three
JPEG/PNG/WebP photos (1 MB each). All expected lines are preserved. Over-receipts,
reductions of prior received quantities, restocked receipts, and stale updates
are rejected. The existing return-write lock serializes saves in PostgreSQL.

Receipt-only saves set local receiving to received with pending inspection. They
do not add sellable inventory or issue a channel refund. Restock remains a separate
existing Manage return action requiring passed inspection and closure. Damaged,
quarantined and vendor-return dispositions stay unavailable for sale.

Receiving history stores actor, time, quantities and destination; photos and
history appear in return Details. Receipt quantities in history are cumulative,
not incremental. Channel lifecycle status is retained independently.

The lookup uses saved returns only and does not start a channel sync. Receiving
requires PostgreSQL. No live deployment or receipt was performed during development.
