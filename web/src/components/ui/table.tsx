"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

const MobileTableContext = React.createContext(false)
const TableLabelsContext = React.createContext<React.ReactNode[]>([])
export function MobileTables({ children }: { children: React.ReactNode }) {
  return <MobileTableContext.Provider value>{children}</MobileTableContext.Provider>
}

function headerLabels(children: React.ReactNode): React.ReactNode[] {
  const labels: React.ReactNode[] = []
  React.Children.forEach(children, child => {
    if (!React.isValidElement<{ children?: React.ReactNode }>(child)) return
    if (child.type === TableHead) labels.push(headerText(child.props.children))
    else labels.push(...headerLabels(child.props.children))
  })
  return labels
}

function headerText(children: React.ReactNode): string {
  return React.Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child)
    return React.isValidElement<{ children?: React.ReactNode }>(child) ? headerText(child.props.children) : ""
  }).join("")
}

function Table({ className, ...props }: React.ComponentProps<"table">) {
  const mobile = React.useContext(MobileTableContext)
  const labels = mobile ? headerLabels(props.children) : []
  return (
    <TableLabelsContext.Provider value={labels}>
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", mobile && "warehouse-mobile-table", className)}
        {...props}
      />
    </div>
    </TableLabelsContext.Provider>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  const labels = React.useContext(TableLabelsContext)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    >{labels.length ? React.Children.map(props.children, (child, index) => {
      if (!React.isValidElement<React.ComponentProps<"td">>(child) || child.type !== TableCell || child.props.colSpan) return child
      return React.cloneElement(child, {}, <>{labels[index] && <span className="warehouse-mobile-cell-label" aria-hidden="true">{labels[index]}</span>}<div className="min-w-0">{child.props.children}</div></>)
    }) : props.children}</tr>
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
