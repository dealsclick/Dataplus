import type { ReactNode } from "react"

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { TableProperties } from "lucide-react"

type OperationalDataTableProps = {
  columns: ReactNode[]
  children: ReactNode
  empty?: boolean
  emptyTitle?: string
  emptyDescription?: string
  colSpan: number
  className?: string
}

function OperationalDataTable({ columns, children, empty = false, emptyTitle = "No results", emptyDescription = "Adjust filters or try another view.", colSpan, className }: OperationalDataTableProps) {
  return <ScrollArea className={className || "w-full"}><Table><TableHeader><TableRow>{columns.map((column, index) => <TableHead key={index}>{column}</TableHead>)}</TableRow></TableHeader><TableBody>{children}{empty && <TableRow><TableCell colSpan={colSpan} className="p-0"><Empty className="min-h-36 border-0"><EmptyHeader><EmptyMedia variant="icon"><TableProperties /></EmptyMedia><EmptyTitle>{emptyTitle}</EmptyTitle><EmptyDescription>{emptyDescription}</EmptyDescription></EmptyHeader></Empty></TableCell></TableRow>}</TableBody></Table><ScrollBar orientation="horizontal" /></ScrollArea>
}

export { OperationalDataTable }
