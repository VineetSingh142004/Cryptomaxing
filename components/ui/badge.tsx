import * as React from "react";
import { cn } from "@/lib/utils";

function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success" | "warning";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors",
        {
          default: "border-transparent bg-primary text-primary-foreground shadow",
          secondary: "border-transparent bg-secondary text-secondary-foreground",
          destructive: "border-transparent bg-destructive text-destructive-foreground shadow",
          outline: "text-foreground",
          success: "border-transparent bg-emerald-600/15 text-emerald-400 border-emerald-600/30",
          warning: "border-transparent bg-amber-600/15 text-amber-400 border-amber-600/30",
        }[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
