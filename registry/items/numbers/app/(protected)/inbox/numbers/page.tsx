import { NumbersScreen } from "@/components/sendo/numbers/numbers-screen";
import { numbersStrings } from "@/components/sendo/numbers/strings";
import { sendoLocale } from "@/lib/sendo-ui";
import {
  connect,
  disconnect,
  list,
  pauseAgent,
  purge,
  refreshBilling,
  setAgentMode,
  setDefault,
  setLabel,
} from "./actions";
import { embeddedSignupConfig, numbersConfig } from "./numbers-config";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  return { title: numbersStrings[sendoLocale].pageTitle };
}

export default async function SendoNumbersPage() {
  // `list` calls requireUser() first: without a user it throws (or redirects) before any data.
  const initial = await list();

  return (
    <div className="h-dvh">
      <NumbersScreen
        locale={sendoLocale}
        initial={initial}
        actions={{
          list,
          connect,
          setDefault,
          setLabel,
          pauseAgent,
          setAgentMode,
          refreshBilling,
          disconnect,
          purge,
        }}
        embeddedSignup={embeddedSignupConfig()}
        links={numbersConfig.links}
        allowPurge={numbersConfig.allowPurge}
      />
    </div>
  );
}
