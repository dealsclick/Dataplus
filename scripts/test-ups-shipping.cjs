const test = require('node:test');
const assert = require('node:assert/strict');

const ups = require('../lib/ups-rating');

test('UPS shipping purchases the selected service and returns a printable label', async (t) => {
  const previousFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes('/oauth/token')) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({
      ShipmentResponse: {
        Response: { ResponseStatus: { Code: '1', Description: 'Success' } },
        ShipmentResults: {
          ShipmentIdentificationNumber: '1Z999AA10123456784',
          NegotiatedRateCharges: { TotalCharge: { CurrencyCode: 'USD', MonetaryValue: '8.50' } },
          PackageResults: { TrackingNumber: '1Z999AA10123456784', ShippingLabel: { ImageFormat: { Code: 'GIF' }, GraphicImage: Buffer.from('GIF89a').toString('base64') } },
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { global.fetch = previousFetch; });
  const result = await ups.createShipment({
    from: { name: 'BuySupply', phone: '718-555-0100', line1: '388 South Avenue', city: 'Staten Island', state: 'NY', postalCode: '10303', country: 'US' },
    to: { name: 'Buyer', phone: '212-555-0100', line1: '1 Main St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
    package: { weight: 5, length: 10, width: 8, height: 6 }, reference: 'BS-1001', serviceCode: '03',
  }, {}, { environment: 'production', clientId: 'client', clientSecret: 'secret', accountNumber: 'ABC123' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].url, /\/api\/shipments\/v2409\/ship$/);
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.ShipmentRequest.Shipment.Service.Code, '03');
  assert.equal(body.ShipmentRequest.Shipment.PaymentInformation.ShipmentCharge.BillShipper.AccountNumber, 'ABC123');
  assert.equal(body.ShipmentRequest.LabelSpecification.LabelStockSize.Width, '4');
  assert.equal(result.trackingNumber, '1Z999AA10123456784');
  assert.equal(result.amount, 8.5);
  assert.equal(result.content.toString(), 'GIF89a');
});

test('UPS shipping rejects an order without a customer phone before calling UPS', async () => {
  await assert.rejects(ups.createShipment({
    from: { name: 'BuySupply', phone: '7185550100', line1: '388 South Avenue', city: 'Staten Island', state: 'NY', postalCode: '10303', country: 'US' },
    to: { name: 'Buyer', line1: '1 Main St', city: 'New York', state: 'NY', postalCode: '10001', country: 'US' },
    package: { weight: 5, length: 10, width: 8, height: 6 }, reference: 'BS-1001', serviceCode: '03',
  }, {}, { environment: 'production', clientId: 'client', clientSecret: 'secret', accountNumber: 'ABC123' }), /customer phone/);
});
