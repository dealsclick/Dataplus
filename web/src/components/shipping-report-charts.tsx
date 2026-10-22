import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

type ReportRow = Record<string, string | number | boolean | null | undefined>

const expenseConfig = {
  purchased: { label: "Purchased label amount", color: "var(--chart-1)" },
  billed: { label: "Final billed shipping", color: "var(--chart-3)" },
  expense: { label: "Shipping expense used in P&L", color: "var(--chart-2)" },
} satisfies ChartConfig

const dimensionConfig = {
  shipments: { label: "Shipments", color: "var(--chart-1)" },
} satisfies ChartConfig

const measurementColors = ["var(--chart-2)", "var(--chart-4)", "var(--chart-3)", "var(--destructive)"]

function number(row: ReportRow, key: string) {
  return Number(row[key] || 0)
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0)
}

function compactMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(value || 0)
}

function shortDate(value: string) {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`)
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date) : value
}

function title(value: unknown, fallback: string) {
  return String(value || fallback).replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase())
}

function EmptyChart() {
  return <div className="flex h-[280px] items-center justify-center text-sm text-muted-foreground">No shipping activity matches this view.</div>
}

export function ShippingReportCharts({ daily, channels, states, dimensionStatuses }: {
  daily: ReportRow[]
  channels: ReportRow[]
  states: ReportRow[]
  dimensionStatuses: ReportRow[]
}) {
  const dailyRows = daily.map((row) => ({
    date: String(row.date || ""),
    label: shortDate(String(row.date || "")),
    purchased: number(row, "estimated_shipping_cost"),
    billed: number(row, "billed_shipping_cost"),
    expense: number(row, "shipping_expense"),
  }))
  const channelRows = channels.slice(0, 8).map((row) => ({
    name: String(row.channel || "Unclassified"),
    purchased: number(row, "estimated_shipping_cost"),
    billed: number(row, "billed_shipping_cost"),
  }))
  const stateRows = states.slice(0, 10).map((row) => ({
    name: String(row.destination_state || "Unknown"),
    expense: number(row, "shipping_expense"),
  }))
  const measurementRows = dimensionStatuses.map((row, index) => ({
    name: title(row.dimension_status, "Unknown"),
    shipments: number(row, "shipment_count"),
    fill: measurementColors[index % measurementColors.length],
  })).filter((row) => row.shipments > 0)

  return <div className="grid gap-5 xl:grid-cols-2">
    <Card>
      <CardHeader><CardTitle className="text-base">Purchased labels versus final billed cost</CardTitle><CardDescription>Daily purchased label amount, final billed shipping, and P&amp;L expense for the selected date basis.</CardDescription></CardHeader>
      <CardContent>{dailyRows.length ? <ChartContainer config={expenseConfig} className="h-[290px]">
        <AreaChart data={dailyRows} margin={{ left: 4, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value) => compactMoney(Number(value))} />
          <ChartTooltip cursor={{ stroke: "var(--border)" }} content={<ChartTooltipContent labelFormatter={(value) => String(value || "Date")} valueFormatter={money} />} />
          <Area type="monotone" dataKey="purchased" stroke="var(--color-purchased)" fill="transparent" strokeWidth={2} />
          <Area type="monotone" dataKey="billed" stroke="var(--color-billed)" fill="transparent" strokeDasharray="5 4" strokeWidth={2} />
          <Area type="monotone" dataKey="expense" stroke="var(--color-expense)" fill="var(--color-expense)" fillOpacity={0.12} strokeWidth={2} />
        </AreaChart>
      </ChartContainer> : <EmptyChart />}</CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Cost by channel</CardTitle><CardDescription>Purchased label amounts compared with final carrier or marketplace billing.</CardDescription></CardHeader>
      <CardContent>{channelRows.length ? <ChartContainer config={expenseConfig} className="h-[290px]">
        <BarChart data={channelRows} margin={{ left: 4, right: 12, top: 8 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} tickFormatter={(value) => String(value).slice(0, 12)} />
          <YAxis tickLine={false} axisLine={false} width={64} tickFormatter={(value) => compactMoney(Number(value))} />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.35 }} content={<ChartTooltipContent valueFormatter={money} />} />
          <Bar dataKey="purchased" fill="var(--color-purchased)" radius={[3, 3, 0, 0]} />
          <Bar dataKey="billed" fill="var(--color-billed)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ChartContainer> : <EmptyChart />}</CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Expense by destination</CardTitle><CardDescription>Top destination states by effective shipping expense.</CardDescription></CardHeader>
      <CardContent>{stateRows.length ? <ChartContainer config={expenseConfig} className="h-[290px]">
        <BarChart data={stateRows} layout="vertical" margin={{ left: 4, right: 24, top: 8 }}>
          <CartesianGrid horizontal={false} />
          <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value) => compactMoney(Number(value))} />
          <YAxis dataKey="name" type="category" tickLine={false} axisLine={false} width={42} />
          <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.35 }} content={<ChartTooltipContent valueFormatter={money} />} />
          <Bar dataKey="expense" fill="var(--color-expense)" radius={[0, 3, 3, 0]} />
        </BarChart>
      </ChartContainer> : <EmptyChart />}</CardContent>
    </Card>

    <Card>
      <CardHeader><CardTitle className="text-base">Package measurement quality</CardTitle><CardDescription>Weight and dimensions retained from the label purchase request.</CardDescription></CardHeader>
      <CardContent className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        {measurementRows.length ? <ChartContainer config={dimensionConfig} className="h-[250px]">
          <PieChart><ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel valueFormatter={(value) => `${value.toLocaleString()} shipments`} />} /><Pie data={measurementRows} dataKey="shipments" nameKey="name" innerRadius="52%" outerRadius="80%" paddingAngle={2}>{measurementRows.map((row) => <Cell key={row.name} fill={row.fill} />)}</Pie></PieChart>
        </ChartContainer> : <EmptyChart />}
        <div className="grid min-w-44 gap-2 text-sm">{measurementRows.map((row) => <div key={row.name} className="flex items-center justify-between gap-4"><span className="flex min-w-0 items-center gap-2 text-muted-foreground"><span className="size-2.5 shrink-0 rounded-sm" style={{ background: row.fill }} /><span className="truncate">{row.name}</span></span><span className="font-medium tabular-nums">{row.shipments.toLocaleString()}</span></div>)}</div>
      </CardContent>
    </Card>
  </div>
}
