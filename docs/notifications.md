# Central notification history

DataPlus stores operational notifications in PostgreSQL so a dismissed popup does not erase the message.

## Scope and visibility

- Notifications belong to the selected organization and company.
- Everyone with access to that company sees the same message history, including messages generated while another user was signed in.
- Read state is per user. Marking an item read does not hide it or mark it read for another user.
- The header bell opens a responsive notification drawer with unread filtering, text search, older-message pagination, user attribution, source, timestamp, and related record links.

## Sources

- Browser messages displayed through Sonner are captured after they are shown and saved with the signed-in user as the actor.
- Server-side critical events are written directly even when no browser is open. Lost external-worker heartbeats create a durable error linked to the affected job.
- Client and server dedupe keys prevent polling, rerenders, and repeated reconciliation from creating duplicate history rows.

## Storage

- `system_notifications` stores company scope, severity, category, title, detail, source, related entity, action URL, actor, timestamps, and structured metadata.
- `system_notification_receipts` stores per-user read state.
- `GET /api/notifications` lists scoped history and unread totals.
- `POST /api/notifications` records a displayed browser message.
- `POST /api/notifications/:id/read` and `POST /api/notifications/read-all` update only the signed-in user's receipt state.

Notifications are audit-oriented operational messages. They do not replace job records, channel activity logs, order history, or fulfillment history; they link users back to those authoritative records.
