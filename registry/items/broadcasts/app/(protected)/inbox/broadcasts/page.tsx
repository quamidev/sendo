import { can, isSendoError, type Actor } from "@quami/sendo";
import { BroadcastsScreen } from "@/components/sendo/broadcasts/broadcasts-screen";
import { BroadcastsNotice } from "@/components/sendo/broadcasts/parts";
import { broadcastsStrings } from "@/components/sendo/broadcasts/strings";
import { serializeBroadcast, serializeNumber } from "@/components/sendo/broadcasts/types";
import { sendo } from "@/lib/sendo";
import { sendoLocale } from "@/lib/sendo-ui";
import {
  cancelBroadcast,
  createBroadcast,
  getBroadcast,
  listAudiences,
  listBroadcasts,
  listRecipients,
  listTemplates,
  previewBroadcast,
} from "./actions";
import { requireUser } from "./broadcasts-config";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: broadcastsStrings[sendoLocale].pageTitle };
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

export default async function SendoBroadcastsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; nuevo?: string }>;
}) {
  const user = await requireUser();
  const actor = await actorOrNull(user.userId, user.tenantId);
  if (actor === null || !can(actor, "broadcasts.manage")) {
    return <BroadcastsNotice kind="forbidden" locale={sendoLocale} />;
  }

  const accounts = await sendo.accounts.list({ tenant: actor.tenantId, includeInactive: true });
  if (accounts.length === 0) {
    return <BroadcastsNotice kind="noNumbers" locale={sendoLocale} />;
  }

  const params = await searchParams;
  const page = await sendo.broadcasts.list({ actor, limit: 20 });
  const [items, opened] = await Promise.all([
    Promise.all(page.items.map((broadcast) => sendo.broadcasts.get(broadcast.id, { actor }))),
    typeof params.id === "string" && params.id !== ""
      ? sendo.broadcasts.get(params.id, { actor }).catch(() => null)
      : Promise.resolve(null),
  ]);

  return (
    <main className="min-h-dvh bg-muted/30">
      <BroadcastsScreen
        locale={sendoLocale}
        numbers={accounts.map(serializeNumber)}
        initialBroadcasts={{ items: items.map(serializeBroadcast), nextCursor: page.nextCursor }}
        initialBroadcast={opened === null ? null : serializeBroadcast(opened)}
        initialCompose={params.nuevo !== undefined}
        actions={{
          listBroadcasts,
          getBroadcast,
          listRecipients,
          listTemplates,
          listAudiences,
          previewBroadcast,
          createBroadcast,
          cancelBroadcast,
        }}
      />
    </main>
  );
}
