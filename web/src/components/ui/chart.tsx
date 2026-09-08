import * as React from "react"
import { ResponsiveContainer, Tooltip } from "recharts"
import type { TooltipContentProps } from "recharts"

import { cn } from "@/lib/utils"

export type ChartConfig = Record<string, { label?: React.ReactNode; color: string }>

const ChartContext = React.createContext<ChartConfig | null>(null)

export function ChartContainer({
  className,
  config,
  children,
  style,
  ...props
}: React.ComponentProps<"div"> & { config: ChartConfig }) {
  const chartId = React.useId().replace(/:/g, "")
  const variables = Object.fromEntries(Object.entries(config).map(([key, value]) => [`--color-${key}`, value.color]))

  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex h-[240px] w-full min-w-0 justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-layer]:outline-hidden [&_.recharts-sector]:outline-hidden",
          className,
        )}
        style={{ ...variables, ...style } as React.CSSProperties}
        {...props}
      >
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

export const ChartTooltip = Tooltip

export function ChartTooltipContent({
  active,
  payload,
  label,
  hideLabel = false,
  labelFormatter,
  valueFormatter,
  className,
}: Partial<TooltipContentProps<number, string>> & React.ComponentProps<"div"> & {
  hideLabel?: boolean
  labelFormatter?: (label: React.ReactNode) => React.ReactNode
  valueFormatter?: (value: number) => React.ReactNode
}) {
  const config = React.useContext(ChartContext)
  if (!active || !payload?.length) return null

  return (
    <div className={cn("grid min-w-36 gap-1.5 rounded-md border bg-popover px-3 py-2 text-xs shadow-md", className)}>
      {!hideLabel && <div className="font-medium">{labelFormatter ? labelFormatter(label) : label}</div>}
      {payload.filter((entry) => entry.value !== undefined).map((entry, index) => {
        const key = String(entry.dataKey || entry.name || "value")
        const value = Number(entry.value || 0)
        const color = entry.color || entry.payload?.fill || config?.[key]?.color
        return (
          <div key={`${key}-${index}`} className="flex items-center justify-between gap-5">
            <span className="flex items-center gap-2 text-muted-foreground"><span className="size-2 rounded-sm" style={{ backgroundColor: String(color || "var(--muted-foreground)") }} />{config?.[key]?.label || entry.name || key}</span>
            <span className="font-medium tabular-nums">{valueFormatter ? valueFormatter(value) : value.toLocaleString()}</span>
          </div>
        )
      })}
    </div>
  )
}
