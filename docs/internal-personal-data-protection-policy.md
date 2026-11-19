# LINQ USA CORP Internal Personal Data Protection Policy

Effective date: November 18, 2026  
Policy owner: DataPlus administrator  
Review frequency: At least annually and after a material system change or security incident

## 1. Purpose and scope

This policy governs personal data processed by DataPlus for private marketplace order management. It applies to LINQ USA CORP employees, contractors, administrators, systems, connected shops, subprocessors, exports, backups, and support activities that may access marketplace personal data.

DataPlus may use marketplace personal data only to manage authorized products, inventory, orders, fulfillment, shipping, returns, accounting evidence, customer support, security, and marketplace compliance. Personal data must not be sold, used for behavioral advertising, or used to create unrelated consumer profiles.

## 2. Accountability

The DataPlus administrator is responsible for this policy, the data inventory, access reviews, deletion requests, incident coordination, subprocessor review, and audit evidence. Management reviews material risks and remediation at least annually.

Personnel with access to personal data must complete privacy and security training at onboarding and annually. Training records must be retained for audit.

## 3. Data inventory and minimization

DataPlus may process seller and shop identifiers, order details, recipient name, shipping address, phone number, masked or marketplace-provided email address, product and SKU data, shipment details, returns, and operational audit evidence.

DataPlus must not request or store buyer payment-card numbers, bank credentials, government identification, marketplace passwords, or unrelated marketing profiles. New data fields and API permissions require a documented purpose and review before production use.

## 4. Access control

- Access requires an authenticated individual account. Shared logins are prohibited.
- Permissions must follow least privilege and be limited by role, company, channel, and seller account where supported.
- Production database and server access is limited to authorized administrators using protected credentials.
- Access is removed promptly when employment, contractor access, or operational need ends.
- Administrative and marketplace actions must retain actor, time, scope, and result where technically available.
- Access and privileged accounts are reviewed at least quarterly.

## 5. Encryption and secrets

- External application traffic must use HTTPS with TLS 1.2 or later.
- Marketplace application secrets, access tokens, and refresh tokens must use authenticated encryption and must not be stored in source code or displayed after storage.
- Passwords and private keys must never be stored in plaintext.
- Personal data stored on portable media is prohibited unless specifically approved and encrypted.
- Exports containing personal data must be minimized, access-controlled, and deleted when the approved task is complete.
- Personal-data storage controls must be reviewed against marketplace requirements before enabling new personal-data permissions.

## 6. Retention and deletion

Personal data is retained only for the authorized service, security, dispute resolution, or a documented legal obligation.

When marketplace services end or Temu issues a valid deletion instruction, the administrator must begin offboarding promptly and complete deletion or de-identification within 30 days unless applicable law requires retention. The offboarding record must include:

1. seller account and shop identifiers;
2. instruction or service-completion date;
3. credentials revoked or removed;
4. synchronization and jobs stopped;
5. operational data deleted or de-identified;
6. exports and temporary files removed;
7. backup expiration or secure deletion handling;
8. legal exceptions, authority, data scope, and expiration date;
9. completion date and approving administrator.

Legally retained data may be used only for the documented legal purpose. It must be access-restricted and deleted when the legal retention period ends.

## 7. Data-subject requests

LINQ USA CORP will assist Temu and other connected marketplaces with verified requests for access, correction, export, restriction, deletion, or opt-out where applicable.

Requests are logged on receipt, identity and marketplace authority are verified, responsive systems are searched, the approved action is completed, and evidence of completion is retained. The target response period is 30 days unless the marketplace or applicable law requires less time. Data that cannot be changed or deleted because of law must be identified with the legal basis and retention period.

## 8. Subprocessors and transfers

Subprocessors must be reviewed before receiving personal data. The review records the legal entity, service, data categories, processing location, security terms, retention, deletion, incident notice, and any further subprocessors.

Current categories include DigitalOcean, LLC for United States cloud hosting and authorized carriers or logistics providers for order delivery. Cross-border transfers require legal and marketplace review.

## 9. Secure development and change management

Material changes must be reviewed, tested, approved, and traceable before production deployment. Reviews must consider authentication, authorization, tenant and seller-account isolation, secrets, personal-data exposure, logging, retention, deletion, and rollback.

Production changes use version control and automated verification. Sensitive production values must not be copied into tests, screenshots, tickets, or source control. Test evidence must use synthetic or properly redacted data.

## 10. Monitoring and audit logs

Security and operational events are monitored to identify unauthorized access, API failures, abnormal job behavior, and data-integrity issues. Logs must avoid personal data unless it is necessary for a documented security or operational purpose. Log and job retention must be bounded and reviewed.

Audit evidence required by Temu must be retained during the agreement and for 12 months afterward unless a longer legal requirement applies.

## 11. Incident response

Personnel must report a suspected loss, unauthorized access, disclosure, alteration, or destruction immediately. The incident lead will contain the issue, preserve evidence, assess affected data and users, remediate the cause, and document decisions.

If an incident affects Temu data, LINQ USA CORP will notify Temu within 24 hours after detection and provide available scope, timing, affected data, containment, remediation, and contact information. Other notices are made as required by applicable law.

## 12. Policy review and exceptions

This policy is reviewed at least annually and after material changes, incidents, marketplace requirement updates, or audit findings. Exceptions require written approval, a business and legal basis, compensating controls, an owner, and an expiration date.
