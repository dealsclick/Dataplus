const CUSTOMER_GROUPS = Object.freeze([
  { customer: 'Marshall', patterns: ['marshall retail group'] },
  { customer: 'Veyer', patterns: ['veyer', 'odp business sourcing'] },
  { customer: 'Skookum', patterns: ['skookum'] },
  { customer: "Skils'kin", patterns: ['skils kin', 'skils in'] },
  { customer: 'Tessera', patterns: ['tessera'] },
  { customer: 'Southern Carlson', patterns: ['southern carlson', 'southerncarlson'] },
  { customer: 'American Freight', patterns: ['american freight', 'af newco'] },
  { customer: 'Eastern Metal Supply', patterns: ['eastern metal supply'] },
  { customer: 'Rising Star', patterns: ['rising star'] },
  { customer: 'Office Depot', patterns: ['office depot', 'regency office products'] },
  { customer: 'United Ace Recycling', patterns: ['united ace recycling', 'united acerecycling'] },
  { customer: 'Caprice Electronics', patterns: ['caprice electronics'] },
  { customer: 'WHSmith North America', patterns: ['whsmith north america'] }
]);

function normalizeCtechName(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function canonicalCtechCustomer(value) {
  const raw=String(value || '').trim(),key=normalizeCtechName(raw);
  if(!key)return 'Unknown customer';
  if(key==='zoro')return 'Zoro';
  if(key.includes('voomi'))return 'VOOMI';
  const group=CUSTOMER_GROUPS.find(entry=>entry.patterns.some(pattern=>key.includes(pattern)));
  return group?.customer || raw;
}

function ctechOrderMetadata(value) {
  const rawCustomer=String(value || '').trim(),canonicalCustomer=canonicalCtechCustomer(rawCustomer);
  const reportChannel=canonicalCustomer==='Zoro' ? 'Zoro' : canonicalCustomer==='VOOMI' ? 'VOOMI' : 'BuySupply B2B';
  return {rawCustomer,canonicalCustomer,reportChannel,customerType:reportChannel==='BuySupply B2B'?'b2b':'channel'};
}

const sqlLiteral=value=>`'${String(value).replace(/'/g,"''")}'`;
function normalizedNameSql(rawExpression) {
  return `trim(regexp_replace(lower(${rawExpression}), '[^a-z0-9]+', ' ', 'g'))`;
}
function ctechRawCustomerSql(dataExpression) {
  return `coalesce(nullif(${dataExpression}->>'rawCustomer',''),nullif(${dataExpression}->>'customer',''),'')`;
}
function classifiedCustomerSql(dataExpression) {
  const raw=ctechRawCustomerSql(dataExpression),key=normalizedNameSql(raw);
  const cases=[
    `when ${key}='zoro' then 'Zoro'`,
    `when ${key} like '%voomi%' then 'VOOMI'`,
    ...CUSTOMER_GROUPS.map(group=>`when (${group.patterns.map(pattern=>`${key} like ${sqlLiteral(`%${pattern}%`)}`).join(' or ')}) then ${sqlLiteral(group.customer)}`)
  ];
  return `(case ${cases.join(' ')} else coalesce(nullif(trim(${raw}),''),'Unknown customer') end)`;
}
function ctechCustomerSql(dataExpression, sourceExpression) {
  return `(case when nullif(${dataExpression}->>'canonicalCustomer','') is not null then ${dataExpression}->>'canonicalCustomer' when lower(${sourceExpression})='zoro' then ${classifiedCustomerSql(dataExpression)} else coalesce(nullif(${dataExpression}->>'customer',''),'Unknown customer') end)`;
}
function ctechChannelSql(dataExpression, sourceExpression) {
  const customer=classifiedCustomerSql(dataExpression);
  return `(case when nullif(${dataExpression}->>'reportChannel','') is not null then ${dataExpression}->>'reportChannel' when lower(${sourceExpression})='zoro' then case when ${customer}='Zoro' then 'Zoro' when ${customer}='VOOMI' then 'VOOMI' else 'BuySupply B2B' end else ${sourceExpression} end)`;
}

module.exports={canonicalCtechCustomer,ctechOrderMetadata,normalizeCtechName,ctechCustomerSql,ctechChannelSql};
