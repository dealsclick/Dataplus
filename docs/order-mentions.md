# Order mentions

DataPlus order notes support durable teammate assignments through `@username` mentions.

## Operator workflow

- Open an order and use the Notes tab.
- Type `@` to search active users, then choose a username from the autocomplete list.
- Saving the note records the complete comment in the order history and creates one private mention per tagged user.
- The tagged user sees the mention in the top-bar `@` inbox and in their notification history. Both entries link directly to the order.
- A recipient can acknowledge a mention while work is in progress and mark it complete when the requested follow-up is finished.
- Completed mentions remain available from the Completed tab for audit history.

## Data and security

- `order_mentions` is the tenant- and company-scoped assignment ledger. It stores the order, note, author, recipient, text, and status timestamps.
- `system_notifications.target_user_id` limits a mention notification to its recipient. Existing notifications without a target remain company-wide.
- Order note authorship and mention status changes come from the authenticated session. Browser-supplied user names are not trusted.
- Mention autocomplete exposes only active users' display name, username, department, and avatar URL.
- A mention is created only for an exact active username. Unknown or inactive handles remain plain note text.

## Verification

Run:

```powershell
node scripts/test-order-mentions.cjs
cd web
.\node_modules\.bin\tsc.cmd -b --pretty false
```

The schema migration is idempotent and runs through `initRelationalSchema()` during deployment/startup.
