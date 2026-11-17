const assert = require("node:assert/strict");
const { parseExternalOperationalPoText } = require("../server");

const currentTemplate = `PURCHASE ORDER
PO No. D188882
2902 W 37th Street
Date: 11/11/2026
Vendor: Ship To
TRUE VALUE COMPANY Linq USA
MFG. ACCT# TERMS SHIP VIA ORDERED BY EXPECTED DATE
20846 NET 30 11/18/2026
QTY ITEM DESCRIPTION UNIT PRICE AMOUNT
8 BUS142423TRV Rasping Jab Hand Saw 6.53 52.24
20 142461 3-Pc. Comfort Grip Pliers Set, Long Nose, Diagonal Cut, Slip Joint 30.40 608.00
15 BUS142486TRV 100-Pc. Shockwave Impact Driver Bit Set, Packout Case 49.52 742.80
10 BUS142489TRV 80-Pc. Shockwave Impact Driver Bit Set 24.76 247.60
20 BUS142523TRV 15-Pc. Shockwave Red Helix Titanium Impact Drill Bit Set 15.16 303.20
1 BUS142677TRV RedLithium Bluetooth Jobsite Ear Buds & Mic 102.70 102.70
30 BUS143823TRV 50-Pc. Shockwave Impact-Duty Drill & Driver Bit Set 20.93 627.90
13 BUS145098TRV 4-Pc. Hook & Pick Set 10.28 133.64
8 BUS145268TRV Fastback Folding Pocket Knife, Camo 13.85 110.80
11 BUS145279TRV Fastback 5-In-1 Folding Pocket Knife 16.60 182.60
50 158978 18-Pc. Shockwave Driver Bit Set 8.74 437.00
50 162510 2PK 6N1 Fold Util Knife 15.97 798.50
20 48-89-2801 21PC BLK Oxide Bit Set 16.48 329.60
5 BUS211227TRV Comfort Grip Hex-Jaw Pliers, 8 In. 11.75 58.75
10 BUS215888TRV Comfort Grip Hex-Jaw Pliers, 10 In. 12.29 122.90
20 BUS221898TRV 23-Pc. Shockwave Titanium Drill Bit Kit 22.28 445.60
30 BUS796732TRV 12-Pc. Sawzall Demolition Reciprocating Saw Blade Set 17.08 512.40
SUBTOTAL 5,816.23
SHIPPING 0.00
TOTAL 5,816.23
Page: 1`;

const parsed = parseExternalOperationalPoText(currentTemplate);
assert.equal(parsed.poNumber, "D188882");
assert.equal(parsed.orderedAt, "2026-11-11");
assert.equal(parsed.expectedAt, "2026-11-18");
assert.equal(parsed.manufacturerAccount, "20846");
assert.equal(parsed.terms, "NET 30");
assert.equal(parsed.items.length, 17);
assert.deepEqual(parsed.items[0], {
  description: "Rasping Jab Hand Saw",
  lineTotal: 52.24,
  qty: 8,
  manufacturerPartNumber: "BUS142423TRV",
  unitCost: 6.53
});
assert.equal(parsed.items[1].manufacturerPartNumber, "142461");
assert.equal(parsed.items[12].manufacturerPartNumber, "48-89-2801");
assert.equal(parsed.items[16].lineTotal, 512.4);
assert.equal(parsed.subtotal, 5816.23);
assert.equal(parsed.shipping, 0);
assert.equal(parsed.total, 5816.23);
assert.equal(Number(parsed.items.reduce((sum, item) => sum + item.lineTotal, 0).toFixed(2)), 5816.23);

const previousTemplate = parseExternalOperationalPoText(`PURCHASE ORDER
PO Number: OLD-100
Date: 10/01/2026
Rasping Jab Saw 52.24\t8 BUS142423TRV 6.53
0.00
52.24
52.24`);
assert.equal(previousTemplate.items.length, 1);
assert.equal(previousTemplate.items[0].manufacturerPartNumber, "BUS142423TRV");
assert.equal(previousTemplate.total, 52.24);

const pdfExtractionOrder = parseExternalOperationalPoText(`PURCHASE ORDER
D188882\tPO No.
SHIP VIA\tTERMS
NET 30
MFG. ACCT#
11/18/2026
Date:
ORDERED BY
20846
QTY \tDESCRIPTION
EXPECTED DATE
ITEM
11/11/2026
UNIT PRICE AMOUNT
Rasping Jab Hand Saw \t52.24\t8 BUS142423TRV \t6.53
0.00
52.24
52.24`);
assert.equal(pdfExtractionOrder.poNumber, "D188882");
assert.equal(pdfExtractionOrder.orderedAt, "2026-11-11");
assert.equal(pdfExtractionOrder.expectedAt, "2026-11-18");
assert.equal(pdfExtractionOrder.manufacturerAccount, "20846");
assert.equal(pdfExtractionOrder.terms, "NET 30");
assert.equal(pdfExtractionOrder.items.length, 1);

console.log("CTech PO template tests passed");
