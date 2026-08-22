# Permission System Smoke Checklist

Use this after deploying a release that changes login, users, templates, or permission checks.

1. Sign in as Luis and confirm the profile badge shows Master Admin.
2. Open Settings > Users and confirm Luis cannot be demoted, deactivated, or permission-edited.
3. Create a test login with a temporary password and a non-admin template.
4. Sign in as the test user, set a permanent password, then confirm only allowed sidebar areas are visible.
5. Try a blocked write action, such as deleting a warehouse audit without Warehouse audits > Delete. The request should fail with a 403.
6. Grant that exact permission to the test user, save, sign out/in, then repeat the action.
7. Create a custom permission template, apply it to the test user, and verify the audit log shows changed permission details.
8. Update the custom template and confirm its version badge increments.
9. Deactivate the test user, save, and confirm any existing test-user session is forced to sign in again.
10. Delete the custom template and confirm assigned users become Custom while keeping their saved permission checks.

Production restart reminder:

```bash
cd /root/dataplus
git pull
node scripts/generate-release-history.js
docker compose up -d --build dataplus
node scripts/write-deployment-status.js
```
