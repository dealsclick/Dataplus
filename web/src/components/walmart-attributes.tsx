import { Input } from './ui/input'

type Json = Record<string, any>

// Resolve only local schema references. Conditional rules remain enforced by the server.
export function walmartSchemaNode(root: Json, node: Json = {}, depth = 0): Json {
  if (depth > 12) return {}
  if (node.$ref?.startsWith('#/')) {
    const resolved = node.$ref.slice(2).split('/').reduce((value: any, key: string) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], root)
    return walmartSchemaNode(root, resolved || {}, depth + 1)
  }
  return node
}

export function WalmartAttributes({ root, schema, value, onChange, depth = 0, offer = false }: { root: Json; schema: Json; value: Json; onChange: (value: Json) => void; depth?: number; offer?: boolean }) {
  const node = walmartSchemaNode(root, schema)
  const required = new Set(node.required || [])
  const entries = Object.entries(node.properties || {}).filter(([key]) => !offer || !['sku', 'productIdentifiers', 'price', 'quantity', 'inventory', 'specProductType'].includes(key)).sort(([a], [b]) => Number(required.has(b)) - Number(required.has(a)) || a.localeCompare(b))
  const update = (key: string, next: unknown) => { const result = { ...value }; if (next === undefined) delete result[key]; else result[key] = next; onChange(result) }
  if (!entries.length || depth > 5) return <p className="text-xs text-muted-foreground">Use the advanced JSON editor for this schema structure. Launch preview validates all conditional requirements.</p>
  return <div className="grid min-w-0 gap-3">{entries.map(([key, raw]) => {
    const field = walmartSchemaNode(root, raw as Json)
    const label = `${field.title || key}${required.has(key) ? ' *' : ''}`
    if (field.type === 'object' || field.properties) return <details key={key} className="min-w-0 rounded border p-3" open={required.has(key) || undefined}><summary className="cursor-pointer break-words text-sm">{label}</summary><div className="mt-3"><WalmartAttributes root={root} schema={field} value={value[key] || {}} onChange={next => update(key, next)} depth={depth + 1} /></div></details>
    return <label key={key} className="grid min-w-0 gap-1 text-sm"><span className="break-words">{label}</span>{field.description && <span className="text-xs break-words text-muted-foreground">{field.description}</span>}{field.enum ? <select className="h-9 w-full min-w-0 rounded border bg-background px-2" value={value[key] === undefined ? '' : JSON.stringify(value[key])} onChange={e => update(key, e.target.value ? JSON.parse(e.target.value) : undefined)}><option value="">Not specified</option>{field.enum.map((option: unknown) => <option key={JSON.stringify(option)} value={JSON.stringify(option)}>{String(option)}</option>)}</select> : field.type === 'boolean' ? <select className="h-9 rounded border bg-background px-2" value={String(value[key] ?? '')} onChange={e => update(key, e.target.value === '' ? undefined : e.target.value === 'true')}><option value="">Not specified</option><option value="true">Yes</option><option value="false">No</option></select> : field.type === 'array' ? <span className="text-xs text-muted-foreground">Edit this list in the advanced JSON fields below. {Array.isArray(value[key]) ? `${value[key].length} entries saved.` : "No entries saved."}</span> : <Input type={['integer', 'number'].includes(field.type) ? 'number' : 'text'} step={field.type === 'integer' ? 1 : 'any'} value={value[key] ?? ''} onChange={e => update(key, e.target.value === '' ? undefined : ['integer', 'number'].includes(field.type) ? Number(e.target.value) : e.target.value)} />}</label>
  })}</div>
}
