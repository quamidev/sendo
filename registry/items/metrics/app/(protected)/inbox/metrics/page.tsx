import { can, isSendoError, type Actor } from "@quami/sendo";
import { MetricsNotice, MetricsScreen } from "@/components/sendo/metrics/metrics-screen";
import { metricsStrings } from "@/components/sendo/metrics/strings";
import {
  metricsTimeZone,
  presetRange,
  serializeMetricsNumber,
  serializeMetricsTag,
  todayIn,
} from "@/components/sendo/metrics/types";
import { sendo } from "@/lib/sendo";
import { sendoLocale } from "@/lib/sendo-ui";
import { loadMetrics } from "./actions";
import { DEFAULT_RANGE_DAYS, requireUser } from "./metrics-config";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: metricsStrings[sendoLocale].pageTitle };
}

/** The actor, or `null` when the user has no role here (`resolveRole` missing or `null`). */
async function actorOrNull(userId: string, tenantId: Actor["tenantId"]): Promise<Actor | null> {
  try {
    return await sendo.actor(userId, tenantId);
  } catch (error) {
    if (isSendoError(error) && error.code === "FORBIDDEN") return null;
    throw error;
  }
}

export default async function SendoMetricsPage() {
  const user = await requireUser();
  const actor = await actorOrNull(user.userId, user.tenantId);
  if (actor === null || !can(actor, "metrics.view")) {
    return <MetricsNotice kind="forbidden" locale={sendoLocale} />;
  }

  const [accounts, tags] = await Promise.all([
    sendo.accounts.list({ tenant: actor.tenantId, includeInactive: true }),
    sendo.tags.list({ actor }),
  ]);
  const numbers = accounts.map(serializeMetricsNumber);
  if (numbers.length === 0) {
    return <MetricsNotice kind="noNumbers" locale={sendoLocale} />;
  }

  const today = todayIn(metricsTimeZone(numbers, null));
  const result = await loadMetrics({
    ...presetRange(DEFAULT_RANGE_DAYS, today),
    account: null,
    tagIds: [],
  });
  if (!result.ok) {
    return <MetricsNotice kind="loadError" body={result.message} locale={sendoLocale} />;
  }

  return (
    <main className="min-h-dvh bg-muted/30">
      <MetricsScreen
        locale={sendoLocale}
        initialReport={result.data}
        numbers={numbers}
        tags={tags.map(serializeMetricsTag)}
        actions={{ loadMetrics }}
      />
    </main>
  );
}
