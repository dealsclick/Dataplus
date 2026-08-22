const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const server = fs.readFileSync(path.join(root, "server.js"), "utf8");
const app = fs.readFileSync(path.join(root, "web", "src", "App.tsx"), "utf8");

function includes(source, needle, message = needle) {
  assert(source.includes(needle), message);
}

function routeGuard(pathNeedle, areaNeedle, actionNeedle) {
  includes(server, pathNeedle, `Missing route guard path marker: ${pathNeedle}`);
  includes(server, areaNeedle, `Missing route guard area: ${areaNeedle}`);
  includes(server, actionNeedle, `Missing route guard action: ${actionNeedle}`);
}

includes(server, "isMasterAdmin ? \"master-admin\"", "Master admin users must stay locked to the master-admin template.");
includes(server, "normalizeAuthPermissions({}, true)", "Master admin permissions must normalize to full access.");
includes(server, "function permissionDiffDetails", "Permission audit diffs must be recorded.");
includes(server, "function revokeAuthSessionsForUser", "Permission/session changes must revoke stale sessions.");
includes(server, "permissionTemplateVersion", "Template version metadata must be persisted on users/templates.");

routeGuard("/api/users/templates", "\"users.permissions\"", "\"permissions\"");
routeGuard("/password", "\"users.accounts\"", "\"passwords\"");
routeGuard("method === \"POST\"", "\"users.accounts\"", "\"create\"");
routeGuard("audit/i.test(pathname)", "\"warehouse.audits\"", "\"delete\"");
routeGuard("parts.includes(\"receive\")", "\"purchasing.receiving\"", "\"receive\"");
routeGuard("parts.includes(\"re-source\")", "\"purchasing.sourcing\"", "\"resource\"");

includes(app, "selectedUserDirty", "User editor must keep unsaved-change state.");
includes(app, "copyPermissionsFromUser", "User editor must support copying from another user.");
includes(app, "copyPermissionsFromTemplate", "User editor must support copying from templates.");
includes(app, "templatePermissionCheckbox", "Template editor must expose permission checks.");
includes(app, "duplicatePermissionTemplate", "Template manager must support duplicating role templates.");
includes(app, "templateUsers", "Template manager must show users assigned to each template.");
includes(app, "permissionMatrixDiffs", "Template manager must compare a user against a template.");
includes(app, "filteredPermissionTemplates", "Template manager must support template search.");
includes(app, "permissionAuditLog", "UI must show permission audit history.");
includes(app, "updateSelectedUserStatus", "UI must confirm/defer deactivation until save.");
includes(app, "canCreateUsers", "UI must gate user creation independently.");
includes(app, "canResetUserPasswords", "UI must gate password resets independently.");
includes(app, "Preview as", "UI must include user access preview.");
includes(app, "event.diffs", "UI must show audit diff details.");

console.log("Permission regression checks passed.");
