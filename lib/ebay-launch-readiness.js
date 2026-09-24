const EBAY_LAUNCH_READINESS_VERSION = "2026-09-24-v2";

function digits(value) {
  return String(value || "").replace(/[^0-9]/g, "");
}

function validGs1CheckDigit(value) {
  const code = digits(value);
  if (![8, 12, 13, 14].includes(code.length)) return false;
  const body = code.slice(0, -1);
  const expected = Number(code.at(-1));
  const sum = [...body].reverse().reduce((total, character, index) => (
    total + Number(character) * (index % 2 === 0 ? 3 : 1)
  ), 0);
  return (10 - (sum % 10)) % 10 === expected;
}

function validIsbn10(value) {
  const code = String(value || "").replace(/[^0-9X]/gi, "").toUpperCase();
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  const sum = [...code].reduce((total, character, index) => (
    total + (character === "X" ? 10 : Number(character)) * (10 - index)
  ), 0);
  return sum % 11 === 0;
}

function validEbayProductIdentifier(type, value) {
  const normalizedType = String(type || "UPC").trim().toUpperCase() || "UPC";
  const code = digits(value);
  if (!code) return false;
  if (normalizedType === "UPC") return code.length === 12 && validGs1CheckDigit(code);
  if (normalizedType === "EAN") return [8, 13].includes(code.length) && validGs1CheckDigit(code);
  if (normalizedType === "ISBN") return validIsbn10(value) || (code.length === 13 && validGs1CheckDigit(code));
  if (normalizedType === "GTIN") return validGs1CheckDigit(code);
  if (normalizedType === "MPN") return String(value || "").trim().length > 0;
  return false;
}

module.exports = {
  EBAY_LAUNCH_READINESS_VERSION,
  validEbayProductIdentifier
};
