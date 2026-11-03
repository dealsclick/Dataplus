const assert = require("assert");
const {
  isPuertoRicoAddress,
  normalizeCarrierShippingAddress,
} = require("../lib/shipping-address");

const marketplaceAddress = {
  name: "Giovannie Vega",
  line1: "Sector El Cobo BZN.3031\nAguadilla PR 00603",
  line2: "",
  city: "aguadilla puerto rico",
  state: "",
  postalCode: "00603",
  country: "PR",
};

assert.equal(isPuertoRicoAddress(marketplaceAddress), true);
assert.deepEqual(normalizeCarrierShippingAddress(marketplaceAddress), {
  ...marketplaceAddress,
  line1: "Sector El Cobo BZN.3031",
  line2: "",
  city: "aguadilla",
  state: "PR",
  postalCode: "00603",
  country: "US",
});

assert.deepEqual(
  normalizeCarrierShippingAddress({
    line1: "Sector El Cobo BZN.3031 Aguadilla PR 00603",
    line2: "Building 2",
    city: "Aguadilla",
    state: "PR",
    postalCode: "00603",
    country: "US",
  }),
  {
    line1: "Sector El Cobo BZN.3031",
    line2: "Building 2",
    city: "Aguadilla",
    state: "PR",
    postalCode: "00603",
    country: "US",
  },
);

const mainlandAddress = {
  line1: "123 Main Street",
  line2: "Apt 4",
  city: "New York",
  state: "NY",
  postalCode: "10001",
  country: "US",
};
assert.deepEqual(normalizeCarrierShippingAddress(mainlandAddress), mainlandAddress);

console.log("shipping address normalization tests passed");
