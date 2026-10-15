import { useRef, useState } from "react"
import { ClipboardPaste, FileSpreadsheet, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { csvSearchTable, csvSearchTerms, MULTI_SEARCH_LIMIT, parseSearchTerms, type CsvSearchTable } from "../lib/multi-search"

const MAX_CSV_BYTES = 2 * 1024 * 1024

export function BulkSearchCsvButton({ onApply, label = "CSV" }: { onApply: (query: string) => void; label?: string }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fileName, setFileName] = useState("")
  const [table, setTable] = useState<CsvSearchTable | null>(null)
  const [column, setColumn] = useState("0")
  const allTerms = table ? csvSearchTerms(table, Number(column), 10_001) : []
  const terms = allTerms.slice(0, MULTI_SEARCH_LIMIT)

  async function chooseFile(file?: File) {
    if (!file) return
    if (file.size > MAX_CSV_BYTES) {
      toast.error("CSV lookup files must be 2 MB or smaller.")
      return
    }
    setLoading(true)
    try {
      const nextTable = csvSearchTable(await file.text())
      if (!nextTable.columns.length || !nextTable.rows.length) throw new Error("The CSV does not contain any lookup values.")
      setFileName(file.name)
      setTable(nextTable)
      setColumn(String(nextTable.suggestedColumn))
      setOpen(true)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to read this CSV file.")
    } finally {
      setLoading(false)
      if (inputRef.current) inputRef.current.value = ""
    }
  }

  function apply() {
    if (!terms.length) return
    onApply(terms.join(", "))
    setOpen(false)
    toast.success(`${terms.length.toLocaleString()} identifier${terms.length === 1 ? "" : "s"} loaded from ${fileName}.`)
  }

  return <>
    <input ref={inputRef} className="sr-only" type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.target.files?.[0])} />
    <Button type="button" size="sm" variant="outline" disabled={loading} title="Load identifiers from CSV" onClick={() => inputRef.current?.click()}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <FileSpreadsheet className="size-4" />} {label}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Bulk lookup from CSV</DialogTitle>
          <DialogDescription>Choose the column containing order numbers, SKUs, tracking numbers, channel order IDs, or other identifiers.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <span className="text-sm font-medium">Identifier column</span>
            <Select value={column} onValueChange={setColumn}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{(table?.columns || []).map((entry) => <SelectItem key={entry.index} value={String(entry.index)}>{entry.label}</SelectItem>)}</SelectContent></Select>
          </div>
          <div className="rounded-md border bg-muted/20 p-3">
            <p className="text-sm font-medium">{terms.length.toLocaleString()} unique identifier{terms.length === 1 ? "" : "s"} ready</p>
            <p className="mt-1 text-xs text-muted-foreground">{terms.slice(0, 8).join(", ") || "No values detected."}{terms.length > 8 ? ` and ${(terms.length - 8).toLocaleString()} more` : ""}</p>
            {allTerms.length > MULTI_SEARCH_LIMIT ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">This column contains {allTerms.length.toLocaleString()} unique values. Only the first {MULTI_SEARCH_LIMIT.toLocaleString()} will be searched; split larger files into smaller lookups.</p> : null}
            {table?.truncatedRows ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">The preview stopped after 10,000 CSV rows.</p> : null}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!terms.length} onClick={apply}>Search {terms.length.toLocaleString()} values</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

export function BulkSearchPasteButton({ onApply }: { onApply: (query: string) => void }) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState("")
  const allTerms = parseSearchTerms(draft, 10_001)
  const terms = allTerms.slice(0, MULTI_SEARCH_LIMIT)

  function apply() {
    if (!terms.length) return
    onApply(terms.join(", "))
    setOpen(false)
    toast.success(`${terms.length.toLocaleString()} identifier${terms.length === 1 ? "" : "s"} added to the search.`)
  }

  return <>
    <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}><ClipboardPaste className="size-4" /> Paste list</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Paste multiple identifiers</DialogTitle>
          <DialogDescription>Paste order numbers, SKUs, tracking numbers, channel order IDs, PO numbers, or batch numbers. Separate values with commas, semicolons, or new lines.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Textarea className="min-h-44 resize-y font-mono text-sm" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={"ABC1, ABC2, ABC3\n\nor\n\nABC1\nABC2\nABC3"} />
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium">Formatted preview</p><span className="text-xs text-muted-foreground">{terms.length.toLocaleString()} unique</span></div>
            <div className="mt-2 max-h-44 overflow-y-auto rounded border bg-background px-3 py-2 font-mono text-xs">
              {terms.length ? terms.map((term, index) => <div key={`${term}-${index}`} className="border-b py-1 last:border-0">{index + 1}. {term}</div>) : <span className="text-muted-foreground">Paste values above to preview them here.</span>}
            </div>
            {allTerms.length > MULTI_SEARCH_LIMIT ? <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">You pasted {allTerms.length.toLocaleString()} unique values. Only the first {MULTI_SEARCH_LIMIT.toLocaleString()} will be searched.</p> : null}
          </div>
        </div>
        <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!terms.length} onClick={apply}>Search {terms.length.toLocaleString()} values</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>
}

export function BulkSearchActions({ onApply }: { onApply: (query: string) => void }) {
  return <div className="flex shrink-0 gap-2"><BulkSearchPasteButton onApply={onApply} /><BulkSearchCsvButton onApply={onApply} /></div>
}
