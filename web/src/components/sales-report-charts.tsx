import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, XAxis, YAxis } from "recharts"

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"

export type SalesDailyChartRow = {
  date: string
  label: string
  netSales: number
  grossSales: number
  profit: number
}

export type SalesChannelChartRow = {
  channel: string
  netSales: number
  orders: number
  profit: number
  fill: string
}

const dailyChartConfig = {
  netSales: { label: "Net sales", color: "var(--chart-1)" },
  grossSales: { label: "Gross sales", color: "var(--chart-2)" },
} satisfies ChartConfig

const channelChartConfig = {
  netSales: { label: "Net sales", color: "var(--chart-1)" },
} satisfies ChartConfig

function moneyLabel(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value || 0)
}

function longDateLabel(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return "Date unavailable"
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(date)
}

export function SalesAreaChart({ data, detailed = false }: { data: SalesDailyChartRow[]; detailed?: boolean }) {
  const gradientId = detailed ? "sales-time-fill" : "sales-net-fill"
  return (
    <ChartContainer config={dailyChartConfig} className={detailed ? "h-[280px]" : "h-[260px]"}>
      <AreaChart data={data} margin={{ left: 4, right: 12, top: 10 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--color-netSales)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-netSales)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
        <YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(value) => moneyLabel(Number(value))} />
        <ChartTooltip
          cursor={{ stroke: "var(--border)" }}
          content={<ChartTooltipContent labelFormatter={(label) => longDateLabel(String(data.find((row) => row.label === label)?.date || ""))} valueFormatter={moneyLabel} />}
        />
        {detailed ? <Area type="monotone" dataKey="grossSales" stroke="var(--color-grossSales)" fill="transparent" strokeWidth={1.5} strokeDasharray="5 4" /> : null}
        <Area type="monotone" dataKey="netSales" stroke="var(--color-netSales)" fill={`url(#${gradientId})`} strokeWidth={2} />
      </AreaChart>
    </ChartContainer>
  )
}

export function SalesChannelPieChart({ data, onActiveChannel }: { data: SalesChannelChartRow[]; onActiveChannel: (channel: string) => void }) {
  return (
    <ChartContainer config={channelChartConfig} className="mx-auto h-[240px] max-w-[300px]">
      <PieChart>
        <ChartTooltip cursor={false} content={<ChartTooltipContent labelFormatter={(value) => String(value || "Channel")} valueFormatter={moneyLabel} />} />
        <Pie data={data} dataKey="netSales" nameKey="channel" innerRadius="55%" outerRadius="82%" paddingAngle={2} onMouseEnter={(entry) => onActiveChannel(String(entry.payload?.channel || ""))}>
          {data.map((entry) => <Cell key={entry.channel} fill={entry.fill} />)}
        </Pie>
      </PieChart>
    </ChartContainer>
  )
}
