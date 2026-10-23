# Direct carrier connections

Direct carrier accounts are configured under **System Settings > Fulfillment > Direct carrier accounts**. This is separate from Veeqo, channel-native labels, and marketplace billing data.

## UPS

UPS is the first supported direct carrier. An authorized user enters:

- Environment: Production or Test.
- OAuth Client ID.
- OAuth Client Secret.
- The six-character billing account number linked to the UPS application.

**Verify and save** requests an OAuth bearer token from UPS before storing the credentials. **Save** stores the credentials without making an external request. The saved environment becomes the active direct UPS account used by Shipping Disputes for negotiated-rate comparisons.

The UPS row separates three different access signals:

- **OAuth access** shows whether the latest connection test succeeded.
- **UPS-reported scopes** shows the named scopes returned in the token response, when UPS includes them.
- **DataPlus uses** shows the APIs implemented in DataPlus. Rating is currently active for negotiated-rate shopping; this does not imply that Shipping, Tracking, or every other UPS API is implemented.

UPS OAuth does not return the Developer Portal's complete Subscription APIs table. When the token has no named scope value, DataPlus says so instead of inferring access. The UPS portal remains the authority for the application's complete subscription list. Safe token metadata such as status, lifetime, and scopes is retained with the connection test; the access token itself is never persisted or returned.

Credentials are written atomically to `data/carrier-runtime-credentials.json` with restricted file permissions. The API returns the Client ID, masked account suffix, timestamps, and whether a secret exists; it never returns the Client Secret or an OAuth access token. Credential updates and tests are permission-gated and recorded in user activity and channel activity.

Environment-variable fallbacks remain supported for deployments that do not use the UI:

- Production: `UPS_CLIENT_ID`, `UPS_CLIENT_SECRET`, `UPS_ACCOUNT_NUMBER`.
- Test: `UPS_TEST_CLIENT_ID`, `UPS_TEST_CLIENT_SECRET`, `UPS_TEST_ACCOUNT_NUMBER`.

The UPS OAuth token request uses Basic authentication, `grant_type=client_credentials`, and the billing account as `x-merchant-id`. Production uses `https://onlinetools.ups.com`; Test uses `https://wwwcie.ups.com`.

## Planned providers

FedEx, USPS, DHL Express, OnTrac, and Amazon Shipping appear as disabled placeholders. They do not accept credentials, request rates, or create labels yet. Each provider will use the same server-only credential boundary when its API implementation is added.
