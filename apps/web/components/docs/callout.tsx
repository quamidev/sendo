import { AlertTriangleIcon, InfoIcon, ShieldAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const variants = {
  note: { icon: InfoIcon, className: "border-border bg-muted/40" },
  warning: { icon: AlertTriangleIcon, className: "border-border bg-accent/50" },
  danger: {
    icon: ShieldAlertIcon,
    className: "border-destructive/40 bg-destructive/5 [&_svg]:text-destructive",
  },
} as const;

export function Callout({
  variant = "note",
  title,
  children,
}: {
  variant?: keyof typeof variants;
  title?: string;
  children: ReactNode;
}) {
  const { icon: Icon, className } = variants[variant];
  return (
    <aside
      className={cn("my-5 flex gap-3 rounded-lg border p-4 text-sm leading-relaxed", className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 [&>p+p]:mt-2">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
      </div>
    </aside>
  );
}
