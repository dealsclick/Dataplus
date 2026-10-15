const assert = require("node:assert/strict");
const { extractMentionHandles, resolveMentionedUsers } = require("../lib/order-mentions");

assert.deepEqual(extractMentionHandles("@Zamzam please check @luis, then @zamzam again."), ["zamzam", "luis"]);
assert.deepEqual(extractMentionHandles("email@test.com and x@y are not mentions; (@ops-team) is."), ["ops-team"]);

const users = [
  { id: "u1", username: "zamzam", status: "active" },
  { id: "u2", username: "Luis", status: "active" },
  { id: "u3", username: "inactive", status: "inactive" },
];
assert.deepEqual(resolveMentionedUsers("@ZAMZAM @inactive @missing", users).map((user) => user.id), ["u1"]);
console.log("Order mention parser tests passed.");
