import { cn } from "@/lib/utils"

const DEFAULT_SYSTEM_LOGO = "/dataplus-symbol-white.svg"

export function systemLogoSource(settings?: Record<string, unknown>) {
  const configured = String(settings?.organizationLogoUrl || settings?.organizationLogoDataUrl || "").trim()
  return configured || DEFAULT_SYSTEM_LOGO
}

export function SystemBrandMark({
  settings,
  className,
  imageClassName,
  label = "DataPlus",
}: {
  settings?: Record<string, unknown>
  className?: string
  imageClassName?: string
  label?: string
}) {
  return <span className={cn("grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-zinc-950 p-1", className)}>
    <img src={systemLogoSource(settings)} alt={`${label} logo`} className={cn("h-full w-full object-contain", imageClassName)} />
  </span>
}
