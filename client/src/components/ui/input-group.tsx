import * as React from "react"
import { Slot } from "@radix-ui/react-slot"

import { cn } from "@/lib/utils"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "flex",
        "[&>[data-slot=input]]:not-first:rounded-l-none [&>[data-slot=input]]:not-last:rounded-r-none",
        "[&>[data-slot=input-group-text]]:not-first:rounded-l-none [&>[data-slot=input-group-text]]:not-last:rounded-r-none",
        "[&>[data-slot=button]]:not-first:rounded-l-none [&>[data-slot=button]]:not-last:rounded-r-none",
        "[&>[data-slot=input]]:not-last:border-r-0 [&>[data-slot=input]]:not-first:border-l-0",
        "[&>[data-slot=input-group-text]]:not-last:border-r-0",
        className
      )}
      {...props}
    />
  )
}

function InputGroupText({
  className,
  asChild,
  ...props
}: React.ComponentProps<"div"> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div"
  return (
    <Comp
      data-slot="input-group-text"
      className={cn(
        "bg-muted text-muted-foreground flex items-center rounded-md border px-3 text-sm font-medium [&_svg:not([class*=\'size-\'])]:size-4 [&_svg]:pointer-events-none",
        className
      )}
      {...props}
    />
  )
}

export { InputGroup, InputGroupText }
