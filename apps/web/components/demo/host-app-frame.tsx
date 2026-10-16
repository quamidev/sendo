import type { ReactNode } from "react";
import { home } from "@/lib/i18n/dictionaries/home";
import type { Lang } from "@/lib/i18n/langs";
import { rich } from "@/lib/i18n/rich";
import { cn } from "@/lib/utils";

/** The sample host app's address: code, the same in both languages. */
const HOST = "admin.torrevista.gt";
const HOST_PATH = "/inbox";

/**
 * A sample host app around the real inbox (AC-ST-8b): a browser bar showing
 * `admin.torrevista.gt/inbox` and the app's own sidebar (Residents, Payments, Bookings,
 * **Inbox · sendo**, Settings) with a note that the inbox is `@sendo/inbox` copied into the
 * project. `children` is the inbox iframe; it fills the rest. The sidebar shows from `lg` so the
 * frame keeps the inbox's two-pane layout (768 px) at 1280.
 */
export function HostAppFrame({
  lang,
  children,
  className,
}: {
  lang: Lang;
  children: ReactNode;
  className?: string;
}) {
  const t = home[lang].host;
  const nav = [
    { key: "residents", label: t.nav.residents },
    { key: "payments", label: t.nav.payments },
    { key: "bookings", label: t.nav.bookings },
    { key: "inbox", label: t.nav.inbox, current: true },
    { key: "settings", label: t.nav.settings },
  ];
  return (
    <section
      aria-label={t.label}
      data-testid="host-app-frame"
      className={cn("flex min-h-0 min-w-0 flex-col", className)}
    >
      {/* Below `md` the home's mobile demo shows the bare inbox (one pane of the two-view toggle). */}
      <div className="flex items-center gap-2.5 border-b bg-muted px-3 py-2 max-md:hidden">
        <span aria-hidden className="flex gap-1.5">
          <i className="size-2.5 rounded-full bg-border" />
          <i className="size-2.5 rounded-full bg-border" />
          <i className="size-2.5 rounded-full bg-border" />
        </span>
        <p className="mx-auto w-full max-w-[26rem] truncate rounded-md bg-background px-2.5 py-1 text-center font-mono text-[11.5px] text-muted-foreground">
          {HOST}
          <span className="font-medium text-foreground">{HOST_PATH}</span>
        </p>
        <span aria-hidden className="w-[46px] shrink-0" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[148px] shrink-0 flex-col border-r bg-muted/50 px-2 py-3 lg:flex">
          <p className="flex items-center gap-1.5 px-2 pb-2.5 text-[13px] font-semibold">
            <i
              aria-hidden
              className="size-[18px] rounded-[5px] bg-linear-135 from-[oklch(0.6_0.12_250)] to-[oklch(0.5_0.14_280)]"
            />
            {t.brand}
          </p>
          <ul className="flex flex-col gap-0.5">
            {nav.map((item) => (
              <li
                key={item.key}
                aria-current={item.current === true ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between rounded-md px-2 py-1.5 text-[12.5px]",
                  item.current === true
                    ? "bg-background text-foreground ring-1 ring-border"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
                {item.current === true && (
                  <span className="font-mono text-[10px] text-whatsapp-strong">{t.inboxBadge}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-auto border-t border-dashed px-2 pt-2 text-[10.5px] leading-snug text-pretty text-muted-foreground [&_code]:text-foreground">
            {rich(t.note)}
          </p>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
      </div>
    </section>
  );
}
