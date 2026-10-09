"use client";

import { Plus } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { BroadcastComposer, errorText } from "./broadcast-composer";
import { BroadcastList } from "./broadcast-list";
import { BroadcastProgress } from "./broadcast-progress";
import { ErrorBar } from "./parts";
import { pressClass, viewEnterClass } from "./press";
import { resolveBroadcastsStrings, type BroadcastsStrings } from "./strings";
import {
  DEFAULT_BROADCASTS_LINKS,
  type BroadcastNumberView,
  type BroadcastsActions,
  type BroadcastsLinks,
  type BroadcastSummaryView,
  type PageView,
} from "./types";

export interface BroadcastsScreenProps {
  /** Every number of the tenant (disconnected ones name old broadcasts; only active ones send). */
  numbers: BroadcastNumberView[];
  /** First page of `listBroadcasts`. */
  initialBroadcasts: PageView<BroadcastSummaryView>;
  /** Opens the progress view of this broadcast (`?id=` on the page). */
  initialBroadcast?: BroadcastSummaryView | null;
  /** Opens the composer (`?nuevo` on the page). */
  initialCompose?: boolean;
  actions: BroadcastsActions;
  links?: Partial<BroadcastsLinks>;
  strings?: Partial<BroadcastsStrings>;
  /** Poll interval of the progress view. */
  pollMs?: number;
  /** Mirror the open view in the URL (`?id=…`, `?nuevo`) so reload and back work. Default true. */
  syncUrl?: boolean;
  className?: string;
}

type View =
  { kind: "list" } | { kind: "compose" } | { kind: "detail"; broadcast: BroadcastSummaryView };

function urlFor(view: View): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("id");
  url.searchParams.delete("nuevo");
  if (view.kind === "detail") url.searchParams.set("id", view.broadcast.id);
  if (view.kind === "compose") url.searchParams.set("nuevo", "");
  return `${url.pathname}${url.search.replace(/nuevo=(&|$)/, "nuevo$1")}${url.hash}`;
}

/** The "Envíos" screen: the broadcasts list, the composer with its review, and the progress view. */
export function BroadcastsScreen({
  numbers,
  initialBroadcasts,
  initialBroadcast = null,
  initialCompose = false,
  actions,
  links: linkOverrides,
  strings: overrides,
  pollMs,
  syncUrl = true,
  className,
}: BroadcastsScreenProps) {
  const strings = resolveBroadcastsStrings(overrides);
  const links = { ...DEFAULT_BROADCASTS_LINKS, ...linkOverrides };
  const [view, setView] = useState<View>(
    initialBroadcast !== null
      ? { kind: "detail", broadcast: initialBroadcast }
      : initialCompose
        ? { kind: "compose" }
        : { kind: "list" },
  );
  const [broadcasts, setBroadcasts] = useState(initialBroadcasts.items);
  const [cursor, setCursor] = useState(initialBroadcasts.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeNumbers = numbers.filter((number) => number.active);

  function go(next: View) {
    setView(next);
    setError(null);
    if (syncUrl) window.history.pushState(null, "", urlFor(next));
    window.scrollTo({ top: 0 });
  }

  function upsert(broadcast: BroadcastSummaryView) {
    setBroadcasts((current) =>
      current.some((item) => item.id === broadcast.id)
        ? current.map((item) => (item.id === broadcast.id ? broadcast : item))
        : [broadcast, ...current],
    );
  }

  const onPopState = useEffectEvent(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (params.has("nuevo")) {
      setView({ kind: "compose" });
    } else if (id === null) {
      setView({ kind: "list" });
    } else {
      const known = broadcasts.find((item) => item.id === id);
      if (known !== undefined) {
        setView({ kind: "detail", broadcast: known });
      } else {
        actions.getBroadcast(id).then(
          (result) => {
            setView(result.ok ? { kind: "detail", broadcast: result.data } : { kind: "list" });
          },
          () => {
            setView({ kind: "list" });
          },
        );
      }
    }
  });

  useEffect(() => {
    if (!syncUrl) return;
    const listener = () => {
      onPopState();
    };
    window.addEventListener("popstate", listener);
    return () => {
      window.removeEventListener("popstate", listener);
    };
  }, [syncUrl]);

  async function loadMore() {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await actions.listBroadcasts(cursor);
      if (result.ok) {
        setBroadcasts((current) => [
          ...current,
          ...result.data.items.filter((item) => !current.some((known) => known.id === item.id)),
        ]);
        setCursor(result.data.nextCursor);
      } else {
        setError(errorText(result, strings));
      }
    } catch {
      setError(strings.errors.UNKNOWN);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className={cn("mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 md:p-8", className)}>
      {view.kind === "list" && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-[17px] font-[650] tracking-[-0.01em]">{strings.pageTitle}</h1>
            <p className="max-w-2xl text-sm text-muted-foreground">{strings.pageDescription}</p>
          </div>
          {broadcasts.length > 0 && activeNumbers.length > 0 && (
            <Button
              className={cn("shrink-0 self-start", pressClass)}
              onClick={() => {
                go({ kind: "compose" });
              }}
            >
              <Plus aria-hidden />
              {strings.newBroadcast}
            </Button>
          )}
        </header>
      )}

      {error !== null && (
        <ErrorBar
          message={error}
          strings={strings}
          onDismiss={() => {
            setError(null);
          }}
        />
      )}

      {view.kind === "list" && (
        <div key="list" className={viewEnterClass}>
          <BroadcastList
            broadcasts={broadcasts}
            numbers={numbers}
            hasMore={cursor !== null}
            loadingMore={loadingMore}
            canCreate={activeNumbers.length > 0}
            strings={strings}
            onOpen={(broadcast) => {
              go({ kind: "detail", broadcast });
            }}
            onCreate={() => {
              go({ kind: "compose" });
            }}
            onLoadMore={() => void loadMore()}
          />
        </div>
      )}

      {view.kind === "compose" && (
        <BroadcastComposer
          numbers={activeNumbers}
          actions={actions}
          links={links}
          strings={strings}
          onCancel={() => {
            go({ kind: "list" });
          }}
          onCreated={(broadcast) => {
            upsert(broadcast);
            go({ kind: "detail", broadcast });
          }}
        />
      )}

      {view.kind === "detail" && (
        <BroadcastProgress
          key={view.broadcast.id}
          broadcast={view.broadcast}
          numbers={numbers}
          actions={actions}
          links={links}
          strings={strings}
          {...(pollMs !== undefined && { pollMs })}
          onBack={() => {
            go({ kind: "list" });
          }}
          onChange={upsert}
        />
      )}
    </div>
  );
}
