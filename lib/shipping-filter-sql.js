const { normalizeShippingRules } = require('./shipping-classification');

// Keep this expression aligned with classifyShipping. Never filter on stale derived labels.
// rawSql is an internal SQL identifier/expression, never request input.
function shippingClassSql(rawSql = 'raw', settings = {}) {
  const rules = normalizeShippingRules(settings);
  const read = key => `coalesce(${rawSql}->>'${key}', ${rawSql}->'raw'->>'${key}')`;
  const measurement = key => {
    const snake = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const value = `coalesce(${read(key)}, ${read(snake)}, ${rawSql}->'original'->>'${snake}', '')`;
    return `(case when btrim(${value}) ~ '^[+]?[0-9]*[.]?[0-9]+([eE][+-]?[0-9]+)?$' then greatest(0, (${value})::numeric) else 0 end)`;
  };
  const pkg = ['Length', 'Width', 'Height'].map(axis => measurement(`package${axis}`));
  const own = ['Length', 'Width', 'Height'].map(axis => measurement(`item${axis}`));
  const hasPackage = `greatest(${pkg.join(',')}) > 0`;
  const dims = pkg.map((value, i) => `(case when ${hasPackage} then ${value} else ${own[i]} end)`);
  const longest = `greatest(${dims.join(',')})`;
  const complete = `least(${dims.join(',')}) > 0`;
  const weight = `coalesce(nullif(${measurement('packageWeight')}, 0), ${measurement('itemWeight')})`;
  const flags = ['requiresFreight', 'freightOnly', 'supplierFreightRequired'].map(key => `${read(key)} in ('true','1')`);
  const modes = [read('shipMode'), read('ship_mode'), read('sourceShippingMethod'), `${rawSql}->'original'->>'ship_mode'`];
  // Source modes can be strings or arrays; JSON array elements are quoted.
  const freight = modes.map(value => `coalesce(${value}, '') ~* '(^|"|\\[)[[:space:]]*(ltl|l tl|freight|truck|truckload|pallet|freight only|ltl only)[[:space:]]*("|\\]|$)'`);
  return `(case when ${read('shippingClassOverride')} = 'ltl' then 'ltl'
    ${rules.shippingHonorSupplierFreight ? `when (${[...flags, ...freight].join(' or ')}) then 'ltl'` : ''}
    when ${longest} > ${rules.shippingParcelMaxLength}
      or (${complete} and (2 * (${dims.join(' + ')}) - ${longest}) > ${rules.shippingParcelMaxGirth})
      or ${weight} > ${rules.shippingParcelMaxWeight} then 'ltl'
    when not (${complete}) or ${weight} = 0 then 'missing_measurements'
    else 'parcel' end)`;
}

module.exports = { shippingClassSql };
