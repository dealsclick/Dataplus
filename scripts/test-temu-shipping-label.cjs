const assert = require("node:assert/strict");
const { extractTemuPackageSns } = require("../server");

assert.deepEqual(extractTemuPackageSns({
  result: { packageSnList: ["PK-4201027867771652045"] },
  success: true
}), ["PK-4201027867771652045"]);

assert.deepEqual(extractTemuPackageSns({
  result: { packageSnList: ["PK-1", "PK-2"], packageSn: "PK-1" }
}), ["PK-1", "PK-2"]);

console.log("Temu shipping-label package parsing tests passed.");
