import * as React from "react"

import { cn } from "@/lib/utils"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-group" className={cn("flex h-10 items-center overflow-hidden rounded-md border bg-background shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50", className)} {...props} />
}

function InputGroupAddon({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="input-group-addon" className={cn("flex h-full shrink-0 items-center px-3 text-muted-foreground", className)} {...props} />
}

function InputGroupInput({ className, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input-group-input" className={cn("h-full min-w-0 flex-1 bg-transparent px-0 text-sm outline-none placeholder:text-muted-foreground", className)} {...props} />
}

export { InputGroup, InputGroupAddon, InputGroupInput }
