import { can, isSendoError, type Actor } from "@quami/sendo";
import { LinksNotice, LinksScreen } from "@/components/sendo/widgets/links-screen";
import { defaultWidgetsStrings as strings } from "@/components/sendo/widgets/strings";
import { SOURCE_PATTERN, serializeNumber } from "@/components/sendo/widgets/types";
import { sendo } from "@/lib/sendo";
import { createLink, listSources } from "./actions";
import { requireUser } from "./links-config";

export const metadata = { title: "Enlaces" };
export const dynamic = "force-dynamic";

/** The actor, or `null` when the user has no role here (`resolveRole` missing or `null`). */
async function actorOrNull(userId: string, tenantId: Actor["tenantId"]): Promise<Actor | null> {
  try {
    return await sendo.actor(userId, tenantId);
  } catch (error) {
    if (isSendoError(error) && error.code === "FORBIDDEN") return null;
    throw error;
  }
}

export default async function SendoLinksPage() {
  const user = await requireUser();
  const actor = await actorOrNull(user.userId, user.tenantId);
  if (actor === null || !can(actor, "numbers.manage")) {
    return <LinksNotice title={strings.forbiddenTitle} body={strings.forbiddenBody} />;
  }

  const accounts = await sendo.accounts.list({ tenant: actor.tenantId });
  const numbers = accounts.map(serializeNumber);
  const first = numbers.find((number) => number.isDefault) ?? numbers[0];
  if (first === undefined) {
    return <LinksNotice title={strings.noNumbersTitle} body={strings.noNumbersBody} />;
  }

  const initialDraft = { account: first.id, text: strings.defaultText, source: "" };
  const [sources, initialLink] = await Promise.all([
    sendo.links.sources({ actor }),
    SOURCE_PATTERN.test(initialDraft.source)
      ? sendo.links.create({ ...initialDraft, tenant: actor.tenantId })
      : Promise.resolve(null),
  ]);

  return (
    <main className="min-h-dvh bg-muted/30">
      <LinksScreen
        numbers={numbers}
        sources={sources}
        initialDraft={initialDraft}
        initialLink={initialLink}
        actions={{ createLink, listSources }}
      />
    </main>
  );
}
