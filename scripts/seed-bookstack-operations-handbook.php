<?php

declare(strict_types=1);

use BookStack\Entities\Models\Book;
use BookStack\Entities\Models\Bookshelf;
use BookStack\Entities\Models\Page;
use BookStack\Entities\Repos\BookRepo;
use BookStack\Entities\Repos\BookshelfRepo;
use BookStack\Entities\Repos\PageRepo;
use BookStack\Users\Models\User;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Auth;

/*
 * Run inside the BookStack application container:
 *   php /tmp/seed-bookstack-operations-handbook.php
 *
 * The script deliberately uses BookStack repositories instead of direct SQL so
 * changes have normal BookStack revisions, activity history, permissions, and
 * search indexing. Running it again updates the named handbook pages.
 */

require __DIR__ . '/../app/www/vendor/autoload.php';

$app = require __DIR__ . '/../app/www/bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

$owner = User::query()->where('email', 'owner@dataplusapp.duckdns.org')->firstOrFail();
Auth::login($owner);

$shelfName = 'DataPlus Operations Handbook';
$shelf = Bookshelf::query()->where('name', $shelfName)->first();
$shelfRepo = app(BookshelfRepo::class);
$bookRepo = app(BookRepo::class);
$pageRepo = app(PageRepo::class);

// BookStack renders the page name as the page heading. Do not repeat it in the
// body, and append the controls operators need when following any procedure.
$workspaceLinks = [
    'Start Here' => [
        'Open orders' => '/orders', 'All orders' => '/orders/all', 'Fulfillment' => '/fulfillment', 'Purchasing' => '/purchasing', 'Jobs' => '/jobs',
    ],
    'Orders and Customers' => [
        'Open orders' => '/orders', 'All orders' => '/orders/all', 'Customers' => '/customers', 'Returns' => '/returns', 'Order data review' => '/orders/data-review',
    ],
    'Fulfillment and Shipping' => [
        'Fulfillment' => '/fulfillment', 'Open orders' => '/orders', 'Warehouse receiving' => '/warehouse/receiving', 'All orders' => '/orders/all',
    ],
    'Purchasing and Supplier Returns' => [
        'Purchasing' => '/purchasing', 'Supplier returns' => '/purchasing/supplier-returns', 'PO reconciliation' => '/purchasing/reconciliation', 'Warehouse receiving' => '/warehouse/receiving',
    ],
    'Warehouse and Inventory' => [
        'Warehouses' => '/warehouse/warehouses', 'Receiving' => '/warehouse/receiving', 'Warehouse audits' => '/warehouse/audits', 'Bins' => '/warehouse/bins', 'Fulfillment' => '/fulfillment',
    ],
    'Returns, Accounting, and Reporting' => [
        'Returns' => '/returns', 'Accounting' => '/accounting', 'Sales reports' => '/reports/sales', 'All orders' => '/orders/all', 'PO reconciliation' => '/purchasing/reconciliation',
    ],
    'Catalog, Channels, and Administration' => [
        'Catalog' => '/catalog', 'Channels' => '/channels', 'Jobs' => '/jobs', 'System settings' => '/settings', 'Wiki controls' => '/workspace/wiki',
    ],
];

$bookControls = [
    'Start Here' => '<h2>Procedure controls</h2><h3>Before starting</h3><ul><li>Confirm you are in the correct company and workspace before taking action.</li><li>Read the complete queue badge and order state; do not make a routing decision from a single status chip.</li><li>Open the order, PO, return, or job record before changing a related record.</li></ul><h3>Completion check</h3><ul><li>The item has a clear next owner or a completed state.</li><li>The activity log explains the decision and references the supporting record.</li><li>No customer, supplier, warehouse, or finance task has been left implied.</li></ul>',
    'Orders and Customers' => '<h2>Order investigation checklist</h2><ol><li>Confirm internal order ID, channel order number, source, paid state, and order date.</li><li>Compare header fulfillment state with every line\'s fulfilled and remaining quantity.</li><li>Review shipment, PO, return, payment, notes, and activity tabs before changing status.</li><li>Refresh the source only when it is likely to hold newer evidence; do not erase useful local history.</li><li>When making a manual correction, record why, who approved it, and what was observed at the source.</li></ol><h2>Evidence standard</h2><p>Use a channel event, carrier scan, vendor communication, receipt, or payment document as evidence. A user recollection is a note, not confirmation.</p>',
    'Fulfillment and Shipping' => '<h2>Pre-label verification</h2><ol><li>Verify the destination address and any address correction.</li><li>Confirm every selected line is physically picked and belongs in the package.</li><li>Measure the packed shipment, not the product listing, and record actual weight.</li><li>Review the service, quoted rate, delivery estimate, and label charge before purchase.</li><li>After purchase, confirm carrier, tracking, label cost, package link, and channel-sync result.</li></ol><h2>After handoff</h2><p>Record the carrier acceptance scan when available. If a label is voided or replaced, preserve both records and explain the final customer-facing tracking.</p>',
    'Purchasing and Supplier Returns' => '<h2>Buyer review before commitment</h2><ol><li>Confirm supplier, catalog SKU/UOM, open demand, receiving warehouse, expected cost, MOQ, and lead time.</li><li>Review cancellations, source-shipped lines, holds, and existing physical allocation before adding demand to a PO.</li><li>For a sent PO change, obtain vendor acknowledgement and retain the original values, variance, and reason.</li><li>At receipt, compare ordered, shipped, received, invoiced, and paid values separately; they are not interchangeable.</li></ol><h2>Vendor evidence</h2><p>Attach or reference the supplier confirmation, invoice, credit memo, RMA, and shipment tracking. This is the evidence that supports later accounting reconciliation.</p>',
    'Warehouse and Inventory' => '<h2>Warehouse transaction checklist</h2><ol><li>Select the physical warehouse and bin before quantity is posted.</li><li>Confirm base SKU and UOM; do not receive a channel bundle as an incorrect single unit.</li><li>Use the proper transaction type: receipt, transfer, audit adjustment, allocation, release, pick, fulfillment, or return receipt.</li><li>Include source document, reason, and operator note for non-routine changes.</li><li>Review the ledger after posting and resolve negative/over-allocated stock immediately.</li></ol><h2>Stop conditions</h2><p>Stop the transaction when the SKU cannot be identified, the bin is unknown, evidence conflicts with the count, or the location is virtual. Escalate rather than inventing a correction.</p>',
    'Returns, Accounting, and Reporting' => '<h2>Financial review checklist</h2><ol><li>Identify whether the amount is revenue, customer shipping, product cost, label cost, marketplace fee, adjustment, refund, vendor credit, or payment.</li><li>Preserve the source document, effective date, currency, and confidence: actual, imported, estimated, unknown, or reconciled.</li><li>Never offset a missing cost by changing sales revenue or a product price.</li><li>Use the reconciliation queue for incomplete evidence and leave operations unblocked unless a genuine fulfillment risk exists.</li></ol><h2>Export rule</h2><p>Exports must retain immutable source references and dates. Re-exporting must not create a second financial event for the same source transaction.</p>',
    'Catalog, Channels, and Administration' => '<h2>Change-control checklist</h2><ol><li>Identify the authoritative source and the exact scope of the change.</li><li>Use a review/dry-run path for catalog, pricing, inventory, or channel actions where available.</li><li>Do not enable a channel or automation until its prerequisites, mapping, and rollback path are known.</li><li>Track long-running work through Jobs, including the artifact and any per-record failures.</li><li>Document the decision in this handbook when it changes how a team operates.</li></ol><h2>Security rule</h2><p>Credentials remain in secure settings only. Screenshots and procedures may show where to configure a value, never the value itself.</p>',
];

$pageDetails = [
    'Daily Operations Guide' => '<h2>Shift sequence</h2><h3>1. Triage before processing</h3><p>Read Needs attention first. Resolve cancellations after allocation, address holds, source status conflicts, and orders at risk of missing their ship-by promise before starting new work. Then work Processing, Ready to ship, and Waiting for PO. Do not switch between queues randomly; complete the current decision and record the handoff.</p><h3>2. Validate the record</h3><p>For each order, compare the source, channel order number, payment state, order date, ship-by date, destination, line quantity, supplier, physical allocation, PO state, and shipment evidence. The header state summarizes the record but does not replace line-level confirmation.</p><h3>3. Close the loop</h3><p>Before ending a shift, make sure every touched item has a next owner, next action, and documented reason. Review Jobs for failed imports or syncs that affect customer work. Do not close a queue simply because its age changed.</p>',
    'Roles, Ownership, and Escalations' => '<h2>How to hand work over</h2><p>A handoff note must name the record, the observed fact, the decision still required, the owner, and the deadline. Example: <em>Order 12345: Shopify is canceled but PO#1044 is submitted and unreceived. Buyer to contact vendor before 2 PM; warehouse must not allocate or ship.</em></p><h2>Escalation tiers</h2><table><thead><tr><th>Tier</th><th>Use when</th><th>Action</th></tr></thead><tbody><tr><td>Operator</td><td>Data correction is supported by source evidence.</td><td>Correct, document, and continue.</td></tr><tr><td>Lead</td><td>Customer promise, inventory allocation, or shipment decision has trade-offs.</td><td>Pause affected route and obtain a decision.</td></tr><tr><td>Finance / admin</td><td>Money, permissions, data loss, integration credentials, or bulk changes are involved.</td><td>Preserve evidence; do not improvise a workaround.</td></tr></tbody></table>',
    'Open Orders and All Orders' => '<h2>Filter procedure</h2><ol><li>Choose the workspace first: Open orders for action, All orders for history and analysis.</li><li>Set the date range independently of other filters. The range is based on channel order date.</li><li>Add status, channel, warehouse, supplier, customer, cost coverage, or return filters as needed.</li><li>Click Apply only after the full filter set is correct. Save the view when the same combination will be used again.</li><li>Use the column picker for the question at hand; avoid making every column permanently visible.</li></ol><h2>What must remain visible</h2><p>Processing, ready-to-ship, waiting-for-PO, held, and genuine attention items remain actionable regardless of age. Completed historical orders follow the selected date range so the page stays fast and readable.</p>',
    'Customer Profiles and Combined Shipment Review' => '<h2>Combined shipment decision table</h2><table><thead><tr><th>Check</th><th>Combine?</th></tr></thead><tbody><tr><td>Same reliable customer identity, destination, warehouse, and compatible promise date</td><td>Yes, after review.</td></tr><tr><td>Temu masked email or uncertain identity match</td><td>No automatic combination; require explicit operator confirmation.</td></tr><tr><td>One order has a purchased/accepted label</td><td>Usually no; void/rework only with approval.</td></tr><tr><td>Different service promises or channel rules</td><td>Keep separate unless the stricter commitment is safely met.</td></tr></tbody></table><h2>Financial allocation</h2><p>When a package serves multiple orders, allocate the actual label cost by the configured proportional basis and retain the shared-shipment identifier. Never copy the full label cost onto each order.</p>',
    'Order Exceptions: What They Mean' => '<h2>Resolution standard</h2><p>Each attention item needs a stable machine-readable reason and a human explanation. The human explanation should say what was compared, what differed, what decision was made, and whether a recheck is scheduled. Clearing an exception requires new evidence, not merely a retry button.</p><h2>Do not classify these as exceptions</h2><ul><li>A completed channel order whose source shipment is correctly imported.</li><li>A historical order without a PO because it was fulfilled outside DataPlus.</li><li>An optional API field that is unavailable but does not block fulfillment or reporting.</li><li>A repeated channel reference that is distinct in the source and has its own internal DataPlus ID.</li></ul>',
    'From Allocation to Shipment' => '<h2>Allocation records</h2><p>An allocation records the order line, physical warehouse, bin when applicable, quantity, allocator, timestamp, and reason. It reduces available physical stock without changing supplier-feed availability. Release an allocation only through the related route so the ledger and order state remain aligned.</p><h2>Mixed-route orders</h2><p>For an order that has physical stock for one line and purchased inventory for another, ship the physical route only when permitted, retain the supplier route as Waiting for PO, and show the order as split fulfillment until all required customer commitments are met. Do not manufacture a single status that hides the unfinished route.</p>',
    'Tracking, Carrier, and Unship Controls' => '<h2>Tracking data fields</h2><table><thead><tr><th>Field</th><th>Required behavior</th></tr></thead><tbody><tr><td>Carrier</td><td>Select the source or label-provider carrier so DataPlus can create a correct tracking link.</td></tr><tr><td>Tracking number</td><td>Keep exact carrier-issued formatting; do not strip letters or leading zeroes.</td></tr><tr><td>Shipment date</td><td>Use carrier acceptance/confirmed date when provided; label-created time is not the same event.</td></tr><tr><td>Label cost</td><td>Record the actual or estimated charge separately from customer shipping revenue.</td></tr><tr><td>Line coverage</td><td>Record which quantities shipped in this package so Remaining reaches zero only when justified.</td></tr></tbody></table><h2>Safe correction</h2><p>Replacing a tracking number must create a new shipment revision and retain the original number, carrier, reason, actor, and timestamp. Update the channel only after the local record is valid.</p>',
    'Buyer Workflow and Purchase Orders' => '<h2>Draft PO review steps</h2><ol><li>Open the supplier draft and verify every demand line still requires purchasing.</li><li>Check the SKU, UOM, vendor SKU, current supplier cost, quantity, MOQ, lead time, ship cutoff, and destination warehouse.</li><li>Remove source-shipped, canceled, fulfilled, or physically allocated demand before approval.</li><li>Review requested quantity against open customer demand and replenishment policy; do not order from the count alone.</li><li>Approve or hold with a reason, then submit through the designated vendor process.</li></ol><h2>Sent PO status accuracy</h2><p>Sent means transmitted to the vendor; it does not mean accepted, paid, shipped, or received. Record acknowledgement, payment, shipment, partial receipt, short shipment, cancellation, and close as separate events.</p>',
    'Receiving, Allocation, and PO Financials' => '<h2>Discrepancy handling</h2><table><thead><tr><th>Situation</th><th>Record</th><th>Do not do</th></tr></thead><tbody><tr><td>Short receipt</td><td>Receive actual quantity and retain remaining expected quantity or close with a shortage reason.</td><td>Mark the order fully received to make the queue disappear.</td></tr><tr><td>Higher invoice cost</td><td>Record actual cost variance and retain invoice reference for reconciliation.</td><td>Overwrite the original expected cost without a revision.</td></tr><tr><td>Damaged arrival</td><td>Receive into quarantine/exception path with evidence.</td><td>Allocate it to customer orders.</td></tr></tbody></table><h2>Allocation prompt</h2><p>After receipt, the operator may allocate immediately. The system should show eligible orders and the proposed priority, but the operator can choose to leave stock unallocated for a later controlled routing run.</p>',
    'Supplier Returns and Return Priority' => '<h2>Disposition decision records</h2><p>Inspection must record condition, sellability, received quantity, reason, source order/return, photos where helpful, and the final disposition. If stock is allocated to an open order, the decision belongs on both the return and allocation trail. If sent to the vendor, retain RMA, package, tracking, expected credit, and credit-received date.</p><h2>Buyer alert criteria</h2><p>Show supplier-return attention when a physically received item is not eligible for customer allocation and has an active supplier-return policy, time window, or expected credit. Do not make buyers search ordinary purchase history for these cases.</p>',
    'Physical Inventory, Bins, and Receiving' => '<h2>Field-by-field manual receipt</h2><table><thead><tr><th>Field</th><th>Operator instruction</th></tr></thead><tbody><tr><td>SKU</td><td>Use the approved catalog SKU. Resolve alias/source-SKU differences before posting.</td></tr><tr><td>Receiving warehouse</td><td>Choose the actual physical location where the stock arrived.</td></tr><tr><td>Bin</td><td>Select an existing configured bin; create one through bin management when authorized.</td></tr><tr><td>Quantity</td><td>Enter the count in the SKU&#39;s base UOM and verify pack conversion.</td></tr><tr><td>Note</td><td>State why the receipt exists and include bill, delivery, RMA, or audit reference.</td></tr></tbody></table><h2>Post-receipt verification</h2><p>Confirm the inventory ledger entry, on-hand balance, bin balance, and open-demand allocation recommendation. If any differs from the physical receipt, stop and investigate before further transactions.</p>',
    'Pick, Pack, and Inventory Accuracy' => '<h2>Pick execution</h2><ol><li>Open the pick list, confirm warehouse and route, and travel by the listed bin sequence.</li><li>Scan the location and SKU where scanning is enabled; resolve a mismatch before moving on.</li><li>Confirm quantity in base units, especially for case packs and channel bundles.</li><li>Place picked stock in a controlled tote/staging location tied to the order or batch.</li><li>At packing, reconcile picked lines to the package and record any short or damaged quantity immediately.</li></ol><h2>Audit trigger</h2><p>Request an audit when repeated pick failures, unexplained negative availability, or a bin/product mismatch indicates that an ordinary adjustment would hide a process problem.</p>',
    'Returns and Refund Reconciliation' => '<h2>Linking source returns</h2><p>Match a channel return to its source order with the channel order identifier first. Store the marketplace return/case identifier separately. If the source cannot provide a reliable link, put it in a review queue rather than attaching it by name or masked email alone.</p><h2>Receiving decision</h2><p>Warehouse receipt confirms physical possession, not financial closure. Inspect before restock, allocate before disposition where applicable, then record refund and vendor-credit events independently. A return that is closed at the marketplace remains visible for history and reporting.</p>',
    'Shared Ledger and Missing-Cost Reconciliation' => '<h2>Reconciliation workflow</h2><ol><li>Open Accounting and filter for missing product cost, missing label cost, estimate-only cost, or unreconciled adjustment.</li><li>Open the linked order, PO, source shipment, invoice, or credit document.</li><li>Enter/import the evidence with its document date and source reference; do not use today\'s date for a historical charge.</li><li>Mark the confidence level and retain the prior estimate.</li><li>Re-run the report with and without incomplete-cost orders to understand both operational volume and financial confidence.</li></ol>',
    'Sales Reports and Margin Interpretation' => '<h2>Margin calculation rules</h2><p>Net sales equals item revenue plus customer shipping collected less refunds/reversals according to the selected reporting policy. Estimated profit subtracts product cost, label cost, marketplace fees, and recorded adjustments. A margin is labeled estimated whenever any cost input is estimated or incomplete. Do not compare a gross-revenue percent to a net-sales margin percent without stating the denominator.</p><h2>Export checklist</h2><p>Before export, set the date range, channel, missing-cost inclusion rule, and comparison period. Export both the summary and order-level drill-down when finance will reconcile the result.</p>',
    'Catalog and Supplier Identity' => '<h2>Reviewing a supplier match</h2><ol><li>Open the product and compare the candidate&#39;s UPC/GTIN, vendor SKU, source SKU, MPN, and UOM.</li><li>Confirm supplier display name and feed code map to the correct canonical vendor profile.</li><li>Approve only identifier evidence; brand, title similarity, or category alone are not enough.</li><li>For a possible match, retain it as a review candidate instead of merging automatically.</li><li>Document the match basis so a later importer or buyer can understand the relationship.</li></ol>',
    'Channel Sync, Imports, and Jobs' => '<h2>Job review procedure</h2><ol><li>Open the job number and read the phase, start time, source window, batch/page progress, and notes.</li><li>Download or review the artifact for skipped, failed, unmatched, and updated records.</li><li>Distinguish source rate limiting from a failed import. Rate limiting should show progress and scheduled continuation.</li><li>For a failure, capture the error class, source request identifier if present, retryability, and business impact.</li><li>Retry only after correcting the root cause or confirming the operation is safe to repeat.</li></ol>',
    'System Settings, Wiki, and Secure Email' => '<h2>Resend setup sequence</h2><ol><li>IT creates and verifies the dedicated transactional sending subdomain in the authoritative DNS provider.</li><li>In Resend, wait for the supplied SPF/DKIM/MX records to verify. Do not alter the Klaviyo marketing subdomain.</li><li>In DataPlus <a href="https://dataplusapp.duckdns.org/settings?tab=email">Email settings</a>, click Configure Resend, enter the API key, choose a sender on the verified domain, Save, and send a test to a deliberately selected recipient.</li><li>Confirm delivery before enabling invitations or reminder workflows.</li></ol><h2>Wiki editing standard</h2><p>Use headings, short purpose statements, prerequisites, numbered instructions, decision tables, warnings, linked screens, and a last-reviewed owner. Use screenshots only when they show a stable workflow and are scrubbed of customer data and secrets.</p>',
];

$books = [
    [
        'name' => 'Start Here',
        'description' => 'How DataPlus is organized, what each queue means, and where an operator should begin every day.',
        'pages' => [
            [
                'name' => 'Daily Operations Guide',
                'html' => <<<'HTML'
<h1>Daily Operations Guide</h1>
<p>This is the starting point for every operations user. DataPlus separates work that needs action now from historical records so the team can move quickly without losing the complete audit trail.</p>
<h2>Start of shift</h2>
<ol>
<li>Open <strong>Orders &gt; Open orders</strong>. Work the queue cards in order: <strong>Needs attention</strong>, <strong>Processing</strong>, <strong>Ready to ship</strong>, then <strong>Waiting for PO</strong>.</li>
<li>Open <strong>Fulfillment</strong> for allocated physical-stock orders. Pick, confirm quantities, pack, buy or record the label, and verify tracking before handing the package to the carrier.</li>
<li>Open <strong>Purchasing</strong> for supplier drafts that require approval, submissions, delivery follow-up, or receiving.</li>
<li>Open <strong>Returns</strong> for received customer returns, inspection decisions, and any vendor-return candidates.</li>
<li>Open <strong>Jobs</strong> only when an import, refresh, sync, or reconciliation needs monitoring. A completed job is evidence; it is not necessarily an operational exception.</li>
</ol>
<h2>Work state vocabulary</h2>
<table><thead><tr><th>State</th><th>Meaning</th><th>Owner</th></tr></thead><tbody>
<tr><td>Processing</td><td>Paid order needs inventory, routing, or work review.</td><td>Operations</td></tr>
<tr><td>Ready to ship</td><td>All required physical inventory is allocated and the fulfillment route can be picked.</td><td>Warehouse / fulfillment</td></tr>
<tr><td>Waiting for PO</td><td>One or more lines require supplier purchasing and physical receipt before shipment.</td><td>Buyer</td></tr>
<tr><td>Split fulfillment</td><td>The order has more than one route. Treat each route independently until all are complete.</td><td>Operations and warehouse</td></tr>
<tr><td>Done</td><td>Source-confirmed shipment or completion. Keep for history unless a return or cancellation changes the situation.</td><td>No immediate action</td></tr>
</tbody></table>
<h2>Non-negotiable rules</h2>
<ul><li>A supplier feed quantity is a sourcing signal, not physical inventory. Never pick from a virtual supplier location.</li><li>Do not create a PO for an order already shipped outside DataPlus.</li><li>Do not overwrite a channel tracking number. Add a replacement so the shipment history remains auditable.</li><li>Use the order's internal ID for DataPlus navigation and the channel order number for marketplace support.</li></ul>
<h2>Useful screens</h2>
<p><a href="https://dataplusapp.duckdns.org/open-orders">Open orders</a> | <a href="https://dataplusapp.duckdns.org/orders">All orders</a> | <a href="https://dataplusapp.duckdns.org/fulfillment">Fulfillment</a> | <a href="https://dataplusapp.duckdns.org/purchasing">Purchasing</a></p>
HTML,
            ],
            [
                'name' => 'Roles, Ownership, and Escalations',
                'html' => <<<'HTML'
<h1>Roles, Ownership, and Escalations</h1>
<p>Use a clear owner for every item. DataPlus records activity, but the queue must still tell a person what to do next.</p>
<table><thead><tr><th>Role</th><th>Primary workspace</th><th>Accountability</th></tr></thead><tbody>
<tr><td>Operations</td><td>Open orders</td><td>Payment review, routing, customer-order accuracy, exceptions, and queue health.</td></tr>
<tr><td>Buyer</td><td>Purchasing</td><td>Supplier selection, PO approval, vendor communication, price changes, and supplier returns.</td></tr>
<tr><td>Warehouse</td><td>Fulfillment and Warehouse</td><td>Receiving, bins, inventory movements, pick/pack, shipment evidence, and return inspection.</td></tr>
<tr><td>Customer service</td><td>Orders, Customers, Returns</td><td>Customer context, returns, refunds, cancellation requests, and documented follow-up.</td></tr>
<tr><td>Finance</td><td>Accounting and Sales reports</td><td>Transaction review, missing-cost reconciliation, vendor payments, charges, and exports.</td></tr>
<tr><td>Administrator</td><td>Settings, Channels, Jobs, Wiki</td><td>Permissions, integrations, policy, monitoring, and change control.</td></tr>
</tbody></table>
<h2>Escalate immediately</h2>
<ul><li>A canceled channel order is already allocated, picked, or attached to a submitted PO.</li><li>A label was purchased with an incorrect address, dimensions, weight, or carrier service.</li><li>A carrier adjustment, marketplace fee, or vendor invoice materially changes profitability.</li><li>An import says completed but records are missing, duplicated, or routed incorrectly.</li><li>A customer return is received for a SKU that has an open purchase requirement; inventory allocation takes priority over disposition.</li></ul>
<h2>Write useful notes</h2>
<p>Use internal notes for the decision, owner, date, and evidence. Example: <em>"09/10: Vendor confirmed replacement shipment. Hold refund until tracking scans. Owner: Maria."</em> Do not put passwords, API keys, card details, or customer-sensitive data in notes.</p>
HTML,
            ],
        ],
    ],
    [
        'name' => 'Orders and Customers',
        'description' => 'Order queues, all-order search, customer profiles, routing, fulfillment status, and multi-order opportunities.',
        'pages' => [
            [
                'name' => 'Open Orders and All Orders',
                'html' => <<<'HTML'
<h1>Open Orders and All Orders</h1>
<p><strong>Open orders</strong> is the action workspace. <strong>All orders</strong> is the complete history and investigation workspace. Do not treat All orders as a queue.</p>
<h2>Open orders</h2>
<p>Use the queue cards to focus on work that cannot wait. Orders that are processing, ready to ship, waiting for a PO, held, or needing attention stay visible even when they are older than the ordinary date range.</p>
<h2>All orders</h2>
<ol><li>Start with a saved date range such as Today, Yesterday, Last 7 days, Last 30 days, Last month, Quarter to date, Year to date, or a custom From/To range.</li><li>Use the search bar for an internal order ID, channel order number, customer, SKU, tracking number, or supplier.</li><li>Use filters beside search for channel, payment, fulfillment, delivery, PO state, customer, warehouse, missing costs, and return state.</li><li>Use the column picker to expose the fields needed for the investigation. Save personal or shared views for recurring work.</li></ol>
<h2>Reading an order</h2>
<ul><li><strong>Paid</strong> confirms the channel payment status, not whether a vendor was paid.</li><li><strong>Completed / shipped</strong> from the channel should place the order in Done and mark the relevant line quantity fulfilled.</li><li><strong>Remaining</strong> is the quantity that DataPlus still considers unfulfilled. It must be zero once a source shipment covers the line.</li><li><strong>No PO</strong> is normal for a shipped external order or a physical-stock route. It is not an error by itself.</li></ul>
<h2>Duplicates and internal IDs</h2>
<p>Each DataPlus order receives its own internal ID, ordered oldest to newest during historical imports and incrementing for future orders. A repeated channel reference is reviewable but not automatically an exception when the source represents distinct records.</p>
HTML,
            ],
            [
                'name' => 'Customer Profiles and Combined Shipment Review',
                'html' => <<<'HTML'
<h1>Customer Profiles and Combined Shipment Review</h1>
<p>Customer profiles consolidate reliable customer identity and order history. Marketplace privacy addresses are not treated as a durable identity; Temu masked email addresses must not be used to merge customer records.</p>
<h2>Customer identity</h2>
<ul><li>Prefer authenticated channel customer IDs, then a stable channel-specific identity.</li><li>Use real email only where the source legitimately provides it.</li><li>Keep channel source and confidence visible so support can understand why records are linked.</li><li>Do not merge profiles solely because names or shipping addresses look similar.</li></ul>
<h2>Repeat customer review</h2>
<p>Use the Customers page to see order count, first and last order date, lifetime revenue, return history, current open orders, and the linked channels. Open the profile before handling a cancellation, replacement, credit, or expedited request.</p>
<h2>Combined shipment opportunity</h2>
<ol><li>DataPlus flags compatible open orders for the same reliable customer and fulfillment destination.</li><li>Confirm the address, warehouse, service level, promised delivery dates, item compatibility, and any channel restrictions.</li><li>Combine only before labels are committed. Keep the original order records and allocate the shared label cost across orders by their proportion of the shipment.</li><li>Do not combine orders with masked marketplace identities or uncertain address matches without operator confirmation.</li></ol>
<p><strong>Result:</strong> one package may fulfill multiple orders, but each order retains its own channel tracking and financial allocation record.</p>
HTML,
            ],
            [
                'name' => 'Order Exceptions: What They Mean',
                'html' => <<<'HTML'
<h1>Order Exceptions: What They Mean</h1>
<p>An exception is an operational conflict that requires a decision. A transient API failure or optional missing field should be recorded as sync health, not mislabeled as an order exception.</p>
<table><thead><tr><th>Exception</th><th>Why it matters</th><th>Resolution</th></tr></thead><tbody>
<tr><td>Cancellation after allocation or PO submission</td><td>Stock may still ship or be received for a canceled sale.</td><td>Pause the route, contact buyer/warehouse, and decide whether to stop, return, or restock.</td></tr>
<tr><td>Shipment status conflicts with lines</td><td>Order is shown done but one or more lines remain open.</td><td>Refresh channel fulfillment; verify source shipment line coverage and tracking.</td></tr>
<tr><td>Missing source cost</td><td>Margin is incomplete or estimated.</td><td>Keep the order operational; send it to accounting reconciliation rather than blocking fulfillment.</td></tr>
<tr><td>Address or carrier validation issue</td><td>Label purchase can fail or be charged later.</td><td>Correct package/address data before purchase or escalation.</td></tr>
<tr><td>Unmatched SKU or supplier</td><td>Routing and purchase logic cannot make a safe decision.</td><td>Resolve catalog identity or select an approved supplier.</td></tr>
</tbody></table>
<p>Every exception needs a reason, owner, created time, last action, and resolution. Once a source confirms shipment, stale routing exceptions should be cleared and the order moved to Done.</p>
HTML,
            ],
        ],
    ],
    [
        'name' => 'Fulfillment and Shipping',
        'description' => 'Allocation, pick-pack-ship, labels, source shipment synchronization, tracking corrections, and multi-order packaging.',
        'pages' => [
            [
                'name' => 'From Allocation to Shipment',
                'html' => <<<'HTML'
<h1>From Allocation to Shipment</h1>
<p>Allocation is the handoff from inventory planning to fulfillment. It reserves real physical stock at a named warehouse; it does not create a label or change the channel order by itself.</p>
<h2>Standard flow</h2>
<ol><li>Receive or confirm physical stock in the warehouse.</li><li>Allocate open demand using the configured priority: actionable commitments first, then shipping urgency, then oldest eligible order.</li><li>The route enters Fulfillment and becomes eligible for picking.</li><li>Create or join a pick list. Scan or confirm picked quantities.</li><li>Pack the order, verify dimensions and weight, then obtain a rate and purchase or record a shipping label.</li><li>Save carrier, tracking number, label cost, package, and fulfillment line quantities.</li><li>Sync tracking to the channel where that channel supports it.</li></ol>
<h2>Physical inventory only</h2>
<p>Virtual supplier-feed availability can help a buyer choose a supplier, but it must never be allocated as warehouse stock. A supplier purchase route becomes ready only after the PO is received into a physical destination.</p>
<h2>Partial fulfillment</h2>
<p>Use separate routes for quantities that ship at different times or from different warehouses. Do not mark the full order shipped until all required lines have fulfillment evidence.</p>
HTML,
            ],
            [
                'name' => 'Tracking, Carrier, and Unship Controls',
                'html' => <<<'HTML'
<h1>Tracking, Carrier, and Unship Controls</h1>
<p>Tracking belongs under the fulfilled line item so an operator can see what shipped, by whom, and with which label. The tracking link must open the correct carrier site.</p>
<h2>Source-shipped orders</h2>
<p>When Shopify, Temu, eBay, or another channel confirms shipment, DataPlus imports the carrier, tracking number, fulfillment date, line quantities, and available label cost. The line status becomes Fulfilled and its Remaining quantity becomes zero. The label action is replaced by source-shipment information.</p>
<h2>Correcting tracking</h2>
<ol><li>Open the order Actions menu and select <strong>Edit tracking</strong>.</li><li>Select the carrier and enter the replacement tracking number.</li><li>Explain the reason for the change.</li><li>Save. DataPlus retains the prior tracking record, who changed it, and when.</li><li>Sync the corrected tracking to the source channel where permitted.</li></ol>
<h2>Unship is a controlled reversal</h2>
<p>Use <strong>Actions &gt; Unship</strong> only when the shipment was recorded in error or has been fully voided. It restores eligible fulfillment actions, preserves the prior shipment history, and must not silently tell a marketplace that a carrier shipment disappeared. Void any purchased label through the carrier/provider first when applicable.</p>
<h2>Carrier links</h2>
<p>Carrier mappings generate clickable links. SwiftX uses its tracking-number query URL; SpeedX uses its tracking-number path. If a carrier has no reliable public link pattern, retain the number and open the source shipment instead.</p>
HTML,
            ],
        ],
    ],
    [
        'name' => 'Purchasing and Supplier Returns',
        'description' => 'Buyer workflow, draft and sent POs, receiving, vendor financials, PO import reconciliation, and return-to-vendor decisions.',
        'pages' => [
            [
                'name' => 'Buyer Workflow and Purchase Orders',
                'html' => <<<'HTML'
<h1>Buyer Workflow and Purchase Orders</h1>
<p>The purchasing workspace is organized by the buyer's next decision, not by technical audit data. Draft POs collect eligible demand; ready-to-send POs need approval; sent POs need vendor and receipt follow-up.</p>
<h2>PO lifecycle</h2>
<table><thead><tr><th>Status</th><th>Meaning</th><th>Buyer action</th></tr></thead><tbody>
<tr><td>Draft / collecting</td><td>Demand is being grouped by supplier and receiving destination.</td><td>Review quantities, cost, MOQs, lead time, and cutoffs.</td></tr>
<tr><td>Ready to send</td><td>Draft needs final approval.</td><td>Approve, hold, edit, or split before submission.</td></tr>
<tr><td>Sent / submitted</td><td>Vendor has received the PO.</td><td>Track acknowledgement, changes, payment, ETA, and partial receipt.</td></tr>
<tr><td>Receiving</td><td>Some or all goods are arriving.</td><td>Receive actual quantities and costs into the physical warehouse.</td></tr>
<tr><td>Closed / canceled</td><td>No more expected receipt.</td><td>Confirm financial outcome and release or resolve outstanding demand.</td></tr>
</tbody></table>
<h2>Edit after sending</h2>
<p>A sent PO can be revised when the vendor permits it. DataPlus must retain the original version, change reason, approver, vendor acknowledgement, and financial impact. Never edit history in place. If the vendor rejects the change, create a corrective PO or credit record instead.</p>
<h2>What the buyer sees</h2>
<p>Keep operational queue cards simple: unassigned demand, draft POs, ready to send, sent, and receiving. Requirement audit, supplier performance, and risk analytics belong in dedicated reporting views, not the primary work queue.</p>
HTML,
            ],
            [
                'name' => 'Receiving, Allocation, and PO Financials',
                'html' => <<<'HTML'
<h1>Receiving, Allocation, and PO Financials</h1>
<h2>Receive against a PO</h2>
<ol><li>Open the PO and confirm its supplier, destination warehouse, and open quantities.</li><li>Scan or select each SKU; enter the received quantity, bin, actual unit cost where known, and any discrepancy.</li><li>Post the receipt. DataPlus creates inventory-ledger entries and preserves before/after quantities.</li><li>Choose whether to allocate the newly received stock to open customer demand now or leave it available for the next routing cycle.</li></ol>
<h2>Allocation priority</h2>
<p>When allocating received inventory, prioritize paid and actionable commitments, then shipping urgency and promise date, then oldest eligible order. Honor holds and exclusions. Do not allocate to canceled, source-shipped, or already fulfilled lines.</p>
<h2>Financial section</h2>
<p>Every PO should show ordered cost, received cost, freight, discounts, vendor tax, payment terms, vendor payment events, invoice/credit references, and variance against expected cost. These are operational estimates until reconciled to an imported vendor invoice or approved payment record.</p>
<h2>QuickBooks readiness</h2>
<p>Maintain immutable transaction dates, vendor identity, document number, currency, line quantity, UOM, unit cost, tax, freight, credits, payment, and allocation basis. Exports should be derived from the shared ledger, not from a visually copied PO screen.</p>
HTML,
            ],
            [
                'name' => 'Supplier Returns and Return Priority',
                'html' => <<<'HTML'
<h1>Supplier Returns and Return Priority</h1>
<p>A customer return becomes a supplier-return candidate only after physical receipt and inspection. Returned stock is not automatically sellable.</p>
<h2>Priority decision</h2>
<ol><li>Receive the customer return and record condition, quantity, photos, and inspection result.</li><li>Check whether open customer orders have an unmet need for the exact sellable SKU.</li><li>If yes, offer the stock for allocation first. This can prevent an unnecessary PO.</li><li>If no qualifying demand exists, continue the configured disposition: restock, quarantine, vendor return, liquidation, recycle, or write-off.</li></ol>
<h2>Vendor-return work queue</h2>
<p>Buyers see items that require vendor-return attention with vendor eligibility, purchase reference, condition, return window, estimated credit, and deadline. Creating a vendor return should retain the original receipt/PO linkage, carrier tracking, vendor RMA, expected credit, and final credit memo.</p>
<h2>Never skip the audit trail</h2>
<p>Do not simply subtract physical stock. Use the disposition workflow so inventory, customer refund, vendor credit, and accounting ledger stay reconcilable.</p>
HTML,
            ],
        ],
    ],
    [
        'name' => 'Warehouse and Inventory',
        'description' => 'Physical receiving, bins, inventory movements, audits, picking, and safe allocation rules.',
        'pages' => [
            [
                'name' => 'Physical Inventory, Bins, and Receiving',
                'html' => <<<'HTML'
<h1>Physical Inventory, Bins, and Receiving</h1>
<p>Physical inventory is created only by a PO receipt, return receipt, transfer, approved audit, or explicit manual adjustment. A supplier-feed record is never physical stock.</p>
<h2>Manual receiving</h2>
<ol><li>Open the SKU inventory detail and choose <strong>Receive physical inventory</strong>.</li><li>Select a physical receiving warehouse. The bin list loads from that warehouse; choose a bin when the warehouse requires one.</li><li>Enter quantity and a concise receiving note. Include a source document number whenever available.</li><li>Post the receipt. The SKU must resolve to the approved catalog identity; if an alias exists, resolve it before receiving.</li></ol>
<h2>Inventory ledger</h2>
<p>Each receipt, adjustment, transfer, allocation, release, pick, fulfillment, and return must create a movement with source, actor, reason, date, and before/after balance. This is the source of truth for investigations.</p>
<h2>Warehouse controls</h2>
<ul><li>Use physical warehouse types for bins, receiving, audits, and fulfillment.</li><li>Do not configure bins or receive inventory into virtual supplier-feed locations.</li><li>Use transfers for movement between physical locations; do not post two manual adjustments.</li><li>Use an audit for count corrections and retain photo or scan evidence when available.</li></ul>
HTML,
            ],
            [
                'name' => 'Pick, Pack, and Inventory Accuracy',
                'html' => <<<'HTML'
<h1>Pick, Pack, and Inventory Accuracy</h1>
<h2>Pick lists</h2>
<p>A pick list has its own ID, warehouse, picker, lines, and scan/pick status. Pick only allocated physical stock. When a scan does not match, stop and resolve the SKU or UOM rather than forcing the quantity.</p>
<h2>Package controls</h2>
<p>Before purchasing a label, verify package dimensions, actual weight, service, and delivery promise. Incorrect dimensions or weight can generate carrier adjustments after shipment; those adjustments must be recorded as a shipment cost, not erased.</p>
<h2>Inventory accuracy loop</h2>
<ol><li>Receive with source evidence.</li><li>Store in a known bin.</li><li>Allocate to a known order.</li><li>Scan/confirm during pick.</li><li>Record shipment quantities.</li><li>Audit high-variance locations regularly.</li></ol>
<p>When a count is wrong, investigate the movement ledger first. An adjustment is the final correction, not the first explanation.</p>
HTML,
            ],
        ],
    ],
    [
        'name' => 'Returns, Accounting, and Reporting',
        'description' => 'Source returns, refunds, shared ledger, cost reconciliation, reporting, exports, and financial review.',
        'pages' => [
            [
                'name' => 'Returns and Refund Reconciliation',
                'html' => <<<'HTML'
<h1>Returns and Refund Reconciliation</h1>
<p>Channel returns and refunds must be imported, linked to the original order, and retained after later order refreshes. A closed eBay return remains historical evidence; it is not deleted because the case is closed.</p>
<h2>Return lifecycle</h2>
<ol><li>Import source return/refund event and link it to the channel order.</li><li>Record requested, approved, in-transit, received, inspected, refunded, and closed status as supplied by the channel or local operation.</li><li>At physical receipt, assess condition and follow allocation-before-disposition policy.</li><li>Post the inventory and financial outcome to the shared ledger.</li></ol>
<h2>Refund versus return</h2>
<p>A refund may occur without stock returning; a return may be received before the customer refund finalizes. Keep these separate. Finance needs both the marketplace reversal and the physical disposition.</p>
<h2>Source synchronization</h2>
<p>Returns imports are idempotent and must not disappear during an order refresh. If an API call fails, record sync health and retry; do not replace the existing linked return with an empty result.</p>
HTML,
            ],
            [
                'name' => 'Shared Ledger and Missing-Cost Reconciliation',
                'html' => <<<'HTML'
<h1>Shared Ledger and Missing-Cost Reconciliation</h1>
<p>The shared ledger is the normalized financial event record beneath orders, POs, receipts, returns, refunds, labels, fees, credits, and payments. It enables consistent export to QuickBooks and other accounting systems without making each platform a special case.</p>
<h2>Required evidence</h2>
<ul><li>Sales revenue: item revenue, customer shipping, discounts, tax handling, marketplace reversal.</li><li>Costs: product unit cost, label cost, vendor freight, marketplace fees, carrier adjustments, and vendor credits.</li><li>References: internal order/PO/return IDs, channel document IDs, vendor invoice or payment references, and effective date.</li><li>Confidence: actual, imported, estimated, unknown, or reconciled.</li></ul>
<h2>Estimated cost policy</h2>
<p>Until a PO or invoice supports a historical actual cost, use the current supplier cost as an explicit estimate. Never present it as a confirmed paid amount. The purchasing PO-import tool can map CSV fields and later associate historical vendor prices by SKU, document date, and evidence.</p>
<h2>Missing-cost queue</h2>
<p>Orders with missing or uncertain cost remain operationally valid but should appear in Accounting &gt; Reconciliation. Users can include or exclude them from margin reports and export the list for remediation.</p>
HTML,
            ],
            [
                'name' => 'Sales Reports and Margin Interpretation',
                'html' => <<<'HTML'
<h1>Sales Reports and Margin Interpretation</h1>
<p>Sales reporting uses the channel order date and selected date range. Apply filters manually so an analyst can adjust channel, dates, and missing-cost policy before recalculating.</p>
<h2>Recommended views</h2>
<ul><li>Today, Yesterday, Last 7 days, Last 30 days, Last month, Last quarter, Year to date, Last year, and Custom range.</li><li>Sales by day, channel, brand, supplier, product/SKU, customer, and order source.</li><li>Gross revenue, customer shipping, refunds/reversals, product cost, label cost, marketplace fees, carrier adjustments, estimated profit, and margin.</li></ul>
<h2>Temu interpretation</h2>
<p>Temu can display base proceeds, customer shipping, estimated revenue, and estimated label cost separately. DataPlus should show customer shipping as revenue and label cost as cost. Example: customer pays $5.50 item revenue plus $2.99 shipping = $8.49 revenue; $5.02 product cost plus $2.29 label cost = $7.31 cost; estimated profit = $1.18.</p>
<h2>Charts</h2>
<p>Use compact trend and composition charts with visible tooltips for comparison. Long daily tables should be optional drill-down views, not the default report layout.</p>
HTML,
            ],
        ],
    ],
    [
        'name' => 'Catalog, Channels, and Administration',
        'description' => 'Product identity, suppliers, channel synchronization, jobs, settings, security, and operational change control.',
        'pages' => [
            [
                'name' => 'Catalog and Supplier Identity',
                'html' => <<<'HTML'
<h1>Catalog and Supplier Identity</h1>
<p>The catalog is the approved product system of record. A product can have many supplier relationships, identifiers, aliases, channel records, and variants without becoming multiple products.</p>
<h2>Matching hierarchy</h2>
<ol><li>Exact UPC/GTIN or another confirmed identifier.</li><li>Exact supplier SKU, source SKU, internal SKU, or approved alias.</li><li>Exact manufacturer part number as a reviewable candidate.</li><li>Close textual matches only as suggestions; never silently merge them.</li></ol>
<h2>Supplier coverage</h2>
<p>Brand is descriptive only and must not determine a supplier match. Show the matching identifier, supplier code, and match basis for every relationship. Inactive suppliers are unavailable for new sourcing unless a deliberate override is documented.</p>
<h2>Inventory and cost</h2>
<p>Keep physical stock, supplier-feed availability, marketplace snapshots, and historical purchase cost separate. Cost UOM must be visible; a null cost means unknown, while zero is a valid value.</p>
HTML,
            ],
            [
                'name' => 'Channel Sync, Imports, and Jobs',
                'html' => <<<'HTML'
<h1>Channel Sync, Imports, and Jobs</h1>
<p>Every channel is controlled by a master enable switch plus operation-specific settings. Disabling a channel blocks imports, webhooks, fulfillment notifications, inventory updates, price updates, and launches.</p>
<h2>Imports</h2>
<ul><li>Historical imports must batch through the full requested period. A page-size limit is not a business ceiling.</li><li>Imports are idempotent: repeated pages update known source records without creating duplicate orders or returns.</li><li>Use the source order date for order history and reporting. Update timestamps are for sync monitoring only.</li><li>Completed source shipments should update line fulfillment, tracking, carrier, and Done state across every channel.</li></ul>
<h2>Jobs workspace</h2>
<p>Long-running work must have a visible job with a numeric reference, status, phase, progress percentage, worker, notes, artifacts, retry/stop actions, and final outcome. Treat source rate limits as scheduling constraints, not reasons to hide progress.</p>
<h2>When a sync is wrong</h2>
<p>Inspect the channel activity and job artifact first. Capture the affected internal order ID, channel order number, source status, and expected data. Do not mass-edit orders until the import logic and source evidence are understood.</p>
HTML,
            ],
            [
                'name' => 'System Settings, Wiki, and Secure Email',
                'html' => <<<'HTML'
<h1>System Settings, Wiki, and Secure Email</h1>
<h2>Settings ownership</h2>
<p>System Settings is for controlled configuration: companies, users and access, catalog rules, warehouse rules, channels, worker resources, email delivery, and operational policies. Changes should be deliberate and traceable.</p>
<h2>Operations Wiki</h2>
<p>BookStack stores the handbook and its own user permissions. DataPlus exposes the Wiki workspace, connection status, publishing safeguards, shelf name, and owner defaults. Keep generated material in review until a responsible owner approves it.</p>
<h2>Resend email delivery</h2>
<ol><li>Use a dedicated transactional subdomain such as <code>notify.dealsclick.com</code>; do not share the Klaviyo marketing subdomain.</li><li>Add the Resend-provided DNS records in the authoritative DNS provider and wait for Resend verification.</li><li>In DataPlus Settings &gt; Email, choose <strong>Configure Resend</strong>, enter the API key, set a verified sender, save, and send a test to the chosen recipient.</li><li>BookStack invitations and password resets travel through the private DataPlus mail relay, so the credential is maintained in one place.</li></ol>
<p>Never place API keys, passwords, or vendor secrets in pages, order notes, job notes, or screenshots.</p>
HTML,
            ],
        ],
    ],
];

foreach ($books as $bookDefinition) {
    $book = Book::query()->where('name', $bookDefinition['name'])->first();
    if (!$book) {
        $book = $bookRepo->create([
            'name' => $bookDefinition['name'],
            'description' => $bookDefinition['description'],
        ]);
    }

    foreach ($bookDefinition['pages'] as $index => $pageDefinition) {
        $page = Page::query()
            ->where('book_id', $book->id)
            ->where('name', $pageDefinition['name'])
            ->first();

        $html = preg_replace('#^\s*<h1[^>]*>.*?</h1>\s*#is', '', $pageDefinition['html']) ?? $pageDefinition['html'];
        $html .= $pageDetails[$pageDefinition['name']] ?? '';
        $links = $workspaceLinks[$bookDefinition['name']] ?? [];
        if ($links) {
            $html .= '<h2>Related DataPlus screens</h2><ul>';
            foreach ($links as $label => $path) {
                $url = 'https://dataplusapp.duckdns.org' . $path;
                $html .= '<li><a href="' . htmlspecialchars($url, ENT_QUOTES, 'UTF-8') . '">' . htmlspecialchars($label, ENT_QUOTES, 'UTF-8') . '</a></li>';
            }
            $html .= '</ul>';
        }
        $html .= $bookControls[$bookDefinition['name']] ?? '';

        $input = [
            'name' => $pageDefinition['name'],
            'html' => $html,
            'summary' => 'Expanded DataPlus operations procedure with linked controls',
        ];

        if ($page) {
            $pageRepo->update($page, $input);
        } else {
            $draft = $pageRepo->getNewDraftPage($book);
            $draft->priority = $index;
            $pageRepo->publishDraft($draft, $input);
        }
    }

    $shelf = Bookshelf::query()->where('name', $shelfName)->first();
    if (!$shelf) {
        $shelf = $shelfRepo->create([
            'name' => $shelfName,
            'description' => 'Role-based operating procedures for DataPlus.',
        ], [$book->id]);
    } elseif (!$shelf->contains($book)) {
        $shelf->appendBook($book);
    }
}

echo "Handbook created or updated: " . count($books) . " books\n";
