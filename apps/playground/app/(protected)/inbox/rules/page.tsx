import { can, isSendoError, type Actor } from "@quami/sendo";
import { RulesNotice, RulesScreen } from "@/components/sendo/workflows/rules-screen";
import { workflowsStrings } from "@/components/sendo/workflows/strings";
import { serializeNumber, serializeRule } from "@/components/sendo/workflows/types";
import { sendo } from "@/lib/sendo";
import { sendoLocale } from "@/lib/sendo-ui";
import { deleteRule, listRules, reorderRules, saveRule, toggleRule } from "./actions";
import { requireUser, resolveUserNames } from "./rules-config";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: workflowsStrings[sendoLocale].pageTitle };
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

export default async function SendoRulesPage() {
  const user = await requireUser();
  const actor = await actorOrNull(user.userId, user.tenantId);
  if (actor === null || !can(actor, "rules.manage")) {
    return <RulesNotice kind="forbidden" locale={sendoLocale} />;
  }

  const [rules, accounts] = await Promise.all([
    sendo.rules.list({ actor }),
    sendo.accounts.list({ tenant: actor.tenantId, includeInactive: true }),
  ]);
  const editors = [
    ...new Set(rules.flatMap((rule) => (rule.updatedBy === null ? [] : [rule.updatedBy]))),
  ];
  const names = editors.length === 0 ? {} : await resolveUserNames(editors).catch(() => ({}));

  return (
    <main className="min-h-dvh bg-muted/30">
      <RulesScreen
        locale={sendoLocale}
        initialRules={rules.map((rule) => serializeRule(rule, names))}
        numbers={accounts.map(serializeNumber)}
        currentUserId={user.userId}
        actions={{ listRules, saveRule, toggleRule, reorderRules, deleteRule }}
      />
    </main>
  );
}
