import { useState } from "react"
import { format, parseISO } from "date-fns"
import { CalendarDays } from "lucide-react"
import { Button } from "./ui/button"
import { Calendar } from "./ui/calendar"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

export function CatalogCreationDateFilter({ from = "", to = "", onApply }: {
  from?: string
  to?: string
  onApply: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [start, setStart] = useState(from)
  const [end, setEnd] = useState(to)
  const invalid = Boolean(start && end && start > end)
  return <Popover open={open} onOpenChange={(next) => {
    if (next) { setStart(from); setEnd(to) }
    setOpen(next)
  }}>
    <PopoverTrigger asChild>
      <Button size="sm" variant="outline" className="h-auto min-h-8 max-w-full whitespace-normal text-left">
        <CalendarDays className="size-4 shrink-0" />
        <span>Creation date{from || to ? `: ${from || "Any"} to ${to || "Any"}` : ""}</span>
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3">
      <p className="text-sm font-semibold">Creation date</p>
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 space-y-1"><Label htmlFor="catalog-created-from">From</Label><Input id="catalog-created-from" className="min-w-0 w-full" type="date" value={start} max={end || undefined} onChange={(event) => setStart(event.target.value)} /></div>
        <div className="min-w-0 space-y-1"><Label htmlFor="catalog-created-to">To</Label><Input id="catalog-created-to" className="min-w-0 w-full" type="date" value={end} min={start || undefined} onChange={(event) => setEnd(event.target.value)} /></div>
      </div>
      <Calendar mode="range" className="mx-auto" selected={{ from: start ? parseISO(start) : undefined, to: end ? parseISO(end) : undefined }} defaultMonth={start ? parseISO(start) : undefined} onSelect={(range) => {
        setStart(range?.from ? format(range.from, "yyyy-MM-dd") : "")
        setEnd(range?.to ? format(range.to, "yyyy-MM-dd") : "")
      }} />
      {invalid && <p role="alert" className="text-xs text-destructive">End date must be on or after start date.</p>}
      <div className="flex justify-between gap-2 border-t pt-3">
        <Button size="sm" variant="ghost" onClick={() => { onApply("", ""); setOpen(false) }}>Clear dates</Button>
        <Button size="sm" disabled={invalid || (!start && !end)} onClick={() => { onApply(start, end); setOpen(false) }}>Apply dates</Button>
      </div>
    </PopoverContent>
  </Popover>
}
