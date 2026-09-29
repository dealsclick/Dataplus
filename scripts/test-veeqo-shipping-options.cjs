const test = require("node:test");
const assert = require("node:assert/strict");
const { selectedServiceValue, veeqoShipmentServiceSelections } = require("../lib/veeqo-shipping-options");

test("uses Veeqo's explicit default when it is an allowed value", () => {
  assert.equal(selectedServiceValue({
    default: "DELIVERY_CONFIRMATION",
    values: [{ value: "NO_CONFIRMATION" }, { value: "DELIVERY_CONFIRMATION" }]
  }), "DELIVERY_CONFIRMATION");
});

test("prefers a neutral service value when the quote has no default", () => {
  assert.equal(selectedServiceValue({
    values: [{ value: "SIGNATURE" }, { value: "NO_CONFIRMATION", label: "No confirmation" }]
  }), "NO_CONFIRMATION");
});

test("copies quote-provided option keys and values into the shipment", () => {
  assert.deepEqual(veeqoShipmentServiceSelections({
    raw: {
      shipping_service_options: [{
        key: "value_added_service__VAS_GROUP_ID_CONFIRMATION",
        type: "select",
        values: [{ value: "NO_CONFIRMATION" }, { value: "SIGNATURE" }]
      }]
    }
  }), { value_added_service__VAS_GROUP_ID_CONFIRMATION: "NO_CONFIRMATION" });
});

test("does not invent values for an option with no allowed or default value", () => {
  assert.deepEqual(veeqoShipmentServiceSelections({
    shippingServiceOptions: [{ key: "additional_input__SHIPMENT_DESCRIPTION", type: "text" }]
  }), {});
});
