import { CheckCircle2, XCircle } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table'

type Mapping = { categoryId?: string; categoryPath?: string; status?: string; locked?: boolean; googleCategory?: { id?: string; breadcrumb?: string; fullName?: string } | null }
export function MappingIndicator({ mapped, channel }: { mapped: boolean; channel: string }) {
  const label = `${channel}: ${mapped ? 'Mapped' : 'Missing mapping'}`
  return <span title={label} role="img" aria-label={label}>{mapped ? <CheckCircle2 aria-hidden className="size-3.5 shrink-0 text-emerald-700 dark:text-emerald-400" /> : <XCircle aria-hidden className="size-3.5 shrink-0 text-red-700 dark:text-red-400" />}</span>
}

export function CategoryMappingOverview({ mappings = {} }: { mappings?: Record<string, Mapping> }) {
  const google = mappings.shopify?.googleCategory
  const rows = [
    ...['shopify', 'ebay', 'walmart', 'temu', 'tiktok', 'whatnot'].map(key => ({ key, label: ({shopify:'Shopify',ebay:'eBay',walmart:'Walmart',temu:'Temu',tiktok:'TikTok Shop',whatnot:'Whatnot'} as Record<string,string>)[key], mapping: mappings[key] })),
    { key: 'google', label: 'Google', mapping: { categoryId: google?.id, categoryPath: google?.breadcrumb || google?.fullName, locked: mappings.shopify?.locked } },
  ]
  return <section aria-label="Saved channel mappings" className="min-w-0 border-b pb-4 mb-5">
    <h3 className="mb-3 text-sm font-semibold">Saved channel mappings</h3>
    <Table className="w-full table-fixed text-xs">
      <TableHeader><TableRow><TableHead className="w-24 sm:w-32">Channel</TableHead><TableHead>Category</TableHead><TableHead className="w-24 sm:w-32">Status</TableHead></TableRow></TableHeader>
      <TableBody>{rows.map(({key,label,mapping}) => <TableRow key={key}>
        <TableCell className="whitespace-normal"><span className="flex items-center gap-2"><MappingIndicator channel={label} mapped={Boolean(mapping?.categoryId)} />{label}</span></TableCell>
        <TableCell className="whitespace-normal [overflow-wrap:anywhere]">{mapping?.categoryPath || mapping?.categoryId || 'Not mapped'}{mapping?.categoryId && <span className="mt-1 block text-muted-foreground">{mapping.categoryId}</span>}</TableCell>
        <TableCell className="whitespace-normal [overflow-wrap:anywhere]">{mapping?.categoryId ? mapping.status?.replace(/_/g, ' ') || 'Saved' : 'Missing'}{mapping?.locked && <span className="block text-muted-foreground">Protected</span>}</TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </section>
}
