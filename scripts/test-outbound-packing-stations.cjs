const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const component = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'outbound-packing-stations.tsx'), 'utf8');
const workspace = fs.readFileSync(path.join(__dirname, '..', 'web', 'src', 'components', 'outbound-audit-workspace.tsx'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const store = fs.readFileSync(path.join(__dirname, '..', 'lib', 'outbound-audit-store.js'), 'utf8');

assert.match(component, /dataplus\.outbound\.packing-stations\.v1/);
assert.match(component, /navigator\.mediaDevices\.enumerateDevices/);
assert.match(component, /devicechange/);
assert.match(component, /captureCompressedEvidence/);
assert.match(component, /Unknown scanner prefix/);
assert.match(component, /Already scanned/);
assert.match(component, /deferOrderMatch: true/);
assert.match(component, /stationName: station\.name/);
assert.match(component, /Photo queued for background upload/);
assert.match(workspace, /<OutboundPackingStations/);
assert.match(workspace, /Packing stations/);
assert.match(workspace, /deferOrderMatch: options\.deferOrderMatch === true/);
assert.match(workspace, /isLikelyPackingStationTrackingBarcode/);
assert.match(workspace, /\^\\d\{12,14\}\$/);
assert.match(server, /stationName: body\.stationName/);
assert.match(store, /station_name/);

console.log('Outbound packing station safety checks passed.');
