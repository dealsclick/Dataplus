# User activity and superuser access

DataPlus treats the superuser as a separate root-of-trust identity, not as an ordinary permission or an editable admin role.

## Superuser identity

- The system-owned `owner` account (Luis) is the default superuser. Deployments may bind the root identity to another immutable user ID with `DATAPLUS_SUPERUSER_USER_ID`.
- A submitted user payload, role name, or permission template cannot grant superuser access.
- User-list responses do not expose superuser status. Only the signed-in superuser session receives `isSuperuser: true`.
- Unauthorized calls to `/api/superuser/*` return `404` so ordinary admins cannot discover private controls through the UI or API.
- Superuser feature audience controls are shown only to the superuser. A feature may later be promoted to admins, but admins never receive the controls that grant or revoke that access.

## Activity ledger

`user_activity_events` stores tenant- and company-scoped operational activity. The first release records:

- page visits from the React application;
- sign-ins and sign-outs;
- export requests; and
- changes to superuser feature audiences.

Page-view recording is asynchronous and uses a keepalive request. Navigation never waits for the audit write. The ledger stores the actor, internal path, event type, timestamp, session identifier, IP address, and browser user agent. It does not store request bodies, passwords, API credentials, or search-query values from export endpoints.

The private Settings > Superuser workspace includes 30-day activity totals and a filterable recent-event table. Activity data always uses the currently authorized tenant and company scope.

## Signed-in devices

The Superuser workspace also shows every unexpired login session for the signed-in username. It distinguishes the current browser from other sessions and shows the device/browser family, IP address, initial sign-in time, and latest recorded activity. The user may revoke any other session without exposing its bearer token. Public session IDs are one-way SHA-256 fingerprints of the underlying token.

Existing sessions created before device tracking may show as an unknown browser until that session makes another authenticated request. A device count represents browser/app sessions, not guaranteed unique physical hardware.

## Feature registry

`superuser_feature_settings` records whether a private feature is enabled and whether its audience is `superuser` or `admins`. Definitions remain in `lib/superuser-access.js`, so adding a future private feature requires an explicit code change and defaults to superuser-only access.

The initial feature key is `user_activity_audit`.
