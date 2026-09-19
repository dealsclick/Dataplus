import { Input } from './ui/input'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { Badge } from './ui/badge'

export function ChannelPricingMethod({ settings, onChange, disabled = false, configurationOnly = false }: {
  settings: { pricingMethod?: unknown; pricingPercent?: unknown }
  onChange: (key: string, value: string | number) => void
  disabled?: boolean
  configurationOnly?: boolean
}) {
  const method = String(settings.pricingMethod || 'legacy')
  return <div className="col-span-full grid min-w-0 gap-3 border-b pb-4 sm:grid-cols-2">
    <div className="grid min-w-0 gap-2"><Label>Pricing method</Label><Select disabled={disabled} value={method} onValueChange={value => onChange('pricingMethod', value)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="legacy">Existing pricing rules</SelectItem><SelectItem value="markup">Cost markup</SelectItem><SelectItem value="gross-margin">Target gross margin (before fees)</SelectItem></SelectContent></Select></div>
    {method !== 'legacy' && <label className="grid min-w-0 gap-2 text-sm">{method === 'gross-margin' ? 'Target gross margin (%)' : 'Cost markup (%)'}<Input disabled={disabled} type="number" min="0" max={method === 'gross-margin' ? '99.99' : '1000'} step="0.01" value={String(settings.pricingPercent ?? 28)} onChange={event => onChange('pricingPercent', Number(event.target.value))} /></label>}
    {configurationOnly && <Badge variant="outline" className="w-fit">Configuration only</Badge>}
  </div>
}
