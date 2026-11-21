const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-production.yml"), "utf8");
const deploy = fs.readFileSync(path.join(root, "scripts", "deploy-production.sh"), "utf8");

assert.match(workflow, /DATAPLUS_DEPLOY_REVISION="\$DEPLOY_REVISION"/);
assert.match(workflow, /git show "\$DEPLOY_REVISION:scripts\/deploy-production\.sh"/);
assert.doesNotMatch(workflow, /git merge --ff-only/);

assert.match(deploy, /git status --porcelain --untracked-files=no/);
assert.match(deploy, /git branch "\$BACKUP_REF" "\$CURRENT_REVISION"/);
assert.match(deploy, /git bundle create .*"\$BACKUP_REF"/);
assert.match(deploy, /git checkout --detach "\$TARGET_REVISION"/);
assert.match(deploy, /\[\[ "\$\(git rev-parse HEAD\)" == "\$TARGET_REVISION" \]\]/);
assert.match(deploy, /DEPLOY_SERVICES=\([^\n]*worker-orders-tiktok[^\n]*\)/, "Production deployment must restart the dedicated TikTok order worker.");
assert.match(deploy, /DEPLOY_SERVICES=\([^\n]*worker-orders-tiktok-returns[^\n]*\)/, "Production deployment must restart the dedicated TikTok return worker.");
assert.match(deploy, /DEPLOY_SERVICES=\([^\n]*worker-orders-tiktok-webhook[^\n]*\)/, "Production deployment must restart the dedicated TikTok webhook worker.");
assert.match(deploy, /docker compose stop[^\n]*worker-orders-tiktok-returns[^\n]*worker-orders-tiktok-webhook/, "Production deployment must replace every dedicated TikTok worker lane.");

console.log("Production deployment history safeguards are configured.");
