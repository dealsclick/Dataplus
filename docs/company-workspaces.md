# Organization and company foundation

## Available in this change

**Orders > Tools** is nested under Orders in the Operations navigation at `/orders/tools`. It opens directly into upload/mapping after a company is selected, with imported-order reports and history beside it. Organization/company setup offers a shortcut with that company preselected. It no longer embeds the importer in company settings. The active session company is selected in the top-bar switcher. Switching reloads the destination and notifies other browser tabs; query-string IDs no longer select an import destination.

Sellercloud's linked shipping-cost workflow is a separate kind of order update. This workspace currently supports reporting-only order-line imports; it does not yet import carrier invoices or update shipping charges on existing orders.

Open **Settings > Companies**; `/organization` redirects there. The master administrator can initialize the organization once. Initialization is transactional and idempotent; it creates the organization, LINQ company registration, BuySupply setup company, initial memberships, shared-catalog source registration, and an audit event. It does not copy, rewrite, or delete operational records.

Existing active users receive LINQ access. The initializing administrator receives organization-owner access. Owners can add empty companies and assign existing active staff to companies. Members can read setup data for assigned companies; owners perform setup mutations. Existing LINQ operation permissions remain in force.

Company selection is stored in the authenticated session and is therefore shared between tabs. Entering another company prevents subsequent authenticated legacy API calls from reaching LINQ storage. Return through **Open LINQ operations** to explicitly select LINQ. `/organization` mounts separately from the legacy operational React shell so it does not start its state/job polling.

Shared product facts are queried in bounded pages, with an allowlist excluding raw data, prices, costs, inventory, and listing metadata. Each company can select products with its own SKU and register vendor accounts. Negotiated costs are per company, product, vendor account, and explicit cost UOM. Blank cost means unknown; zero is preserved. Cost changes include before/after audit evidence. Company setup data is durable in PostgreSQL and does not use the JSON fallback.

The current catalog source is a migration bridge to existing LINQ product identities. It is restricted to the original organization. It is not a platform-wide shared catalog, nor a physical extraction of all product facts into a new master table.

## Deliberately not enabled yet

Both companies now have a **Manual orders** module with CSV/XLSX/XLS upload, column mapping, validated preview, explicit company confirmation, imported-order reports and line details, import history, and batch rollback. Importers use the first worksheet with headers on the first row, up to 10 MB and 10,000 lines. Parse work runs in a memory/time-bounded worker thread; applies use bounded inserts in one PostgreSQL transaction. Each import receives a numeric batch reference. Original parsed values, mapping, issues, source file hash, and normalized lines remain in company-owned batch evidence.

Use a stable source system name for repeat exports. Identity is tenant/company/source/order/line; SKU can substitute for source line ID only when it is unique within an order. Identical lines are skipped; changed lines are blocked for review. Repeated SKUs require a real source line ID. Preview tokens prevent another tab's changed mapping from being silently confirmed. Rollback deactivates only lines created by that batch and retains audit evidence. Missing costs stay unknown, extended amounts take precedence over unit calculations with warnings on discrepancies, and source profit is never used as calculated profit. Reports filter by source, exact status, and inclusive dates; totals cover manual imports only and do not merge with existing marketplace sales reports. The source must use the company's currency (currently USD).

Operational order routing, fulfillment, purchasing, inventory, channel credentials, and accounting for BuySupply are not enabled. Current company cost records do not feed existing LINQ price calculations. No historical spreadsheet is imported automatically.

This change does not make the application ready to host unrelated paying customers. User authentication, legacy workers, jobs, files, webhook/OAuth callbacks, global settings, and existing operational tables remain LINQ-owned. No new tenant-provisioning endpoint is exposed. New storage uses explicit query scoping and composite foreign keys; PostgreSQL row-level security has not been deployed. Platform administration and billing are not implemented.

## Remaining migration sequence

1. Extract shared product identity/content into tenant-owned master records; maintain stable mappings to LINQ product IDs. Move LINQ commercial data into company records with reconciliation and rollback. Connect company-specific supplier accounts to canonical supplier identities.
2. Extend manual imports with reusable saved mapping profiles, additional worksheet selection, and optional reconciliation to native marketplace reports. Keep source sale costs immutable when negotiated costs change. Operational import must be a separate future mode with its own routing safeguards.
3. Migrate orders, transactions, customers, POs, inventory ownership, settings, and numbering with tenant/company keys. Add database policies and company-aware constraints, and validate reads and writes under restricted database roles.
4. Scope workers, queues, schedules, caches, artifacts, audit logs, OAuth state, webhooks, credentials, AI tools, and channel actions. Keep legacy endpoints bound to LINQ until each replacement has isolation tests.
5. Migrate authentication and membership lifecycle, including invites, owner transfer, deactivation, and tenant administration. Add company permission roles and subscription provisioning.
6. Reconcile company reporting, test adversarial access across tenants and companies, and only then enable unrelated tenant onboarding and full operations in new companies.

## Verification

`node scripts/test-company-workspaces.cjs` runs validation tests. Setting `COMPANY_TEST_DATABASE_URL` to an isolated local database whose name ends in `_company_test` also exercises real PostgreSQL bootstrap concurrency, access denial, company grants/revocation, catalog projection, costs, cross-company foreign keys, persistence, and HTTP routing. The suite uses and removes its own schema.

Also run the React TypeScript check, React build, and `git diff --check`. Review `/organization` at desktop and narrow mobile widths. Do not initialize the company registry in production until the deployment has been reviewed; this change introduces an access boundary for users created after initialization, who must explicitly receive company membership.

Tools includes a Templates tab with downloadable blank CSVs for standard unit-price order lines and historical extended sales/cost lines. Both formats use the existing mapping/validation importer and work for either company. The former `/orders/imports` URL remains a compatible entry point. Templates do not contain sample orders or implement shipping-cost updates.

Tools pages belong to their parent workspace. `/orders/tools` contains only order tools and order templates; future catalog tools belong on a separate Catalog > Tools page. Do not add a global top-level Tools navigation item.

Company management belongs in System Settings > Companies (`/settings?tab=companies`), with company creation under Actions > Add company. The old `/organization` route redirects there. The Companies tab uses the shared settings navigation but loads company APIs independently of LINQ operational polling. Opening company settings does not change the session company; Open LINQ operations explicitly selects LINQ.

Companies uses the main App shell so the permission-filtered sidebar, account controls, and theme remain consistent. Its company-settings mode skips automatic legacy state/jobs polling; leaving that mode loads the destination workspace normally. The initialization panel is explicitly one-time and disappears after initialization.

Company access now lives with each user under Settings > Users. Select a login, check its allowed companies, and use Save company access. This save is separate from profile/action-permission edits. Organization owners retain all-company access. The API additionally requires users.permissions view/permissions rights. A searchable company switcher is shown in the main header, including Companies and Order Tools. Only authorized companies are listed; before initialization it identifies the existing LINQ operation and links to setup. Reporting companies land in Order Tools; LINQ lands in Orders unless switching within Tools.

## Normal company order workspace

Switching companies now opens the standard Orders page (or stays in Tools when switching there). New companies have no connected channels. A company-scoped operational-state table stores manual drafts, converted orders, numbering, and saved order views; it is separate from both LINQ operations and reporting imports. Draft creation/editing/duplication and conversion reuse the existing normalizers and standard React screens. Conversion is transactional and idempotent, and every mutation is audited. Shared catalog lookup exposes only product identity; unknown manual order costs remain unknown.

This does not complete operational parity. Marketplace connection callbacks, purchasing, physical inventory, fulfillment, accounting, and other legacy mutation paths are not yet company-scoped. Unsupported company operations fail explicitly and never fall through to LINQ. Existing historical file imports remain reporting records under Orders > Tools and do not become fulfillable orders.
