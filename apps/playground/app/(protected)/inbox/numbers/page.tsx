import { NumbersScreen } from "@/components/sendo/numbers/numbers-screen";
import {
  connect,
  disconnect,
  list,
  pauseAgent,
  refreshBilling,
  setAgentMode,
  setDefault,
  setLabel,
} from "./actions";
import { embeddedSignupConfig, numbersConfig } from "./numbers-config";

export const metadata = { title: "Números de WhatsApp" };
export const dynamic = "force-dynamic";

export default async function SendoNumbersPage() {
  // `list` calls requireUser() first: without a user it throws (or redirects) before any data.
  const initial = await list();

  return (
    <div className="h-dvh">
      <NumbersScreen
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
        }}
        embeddedSignup={embeddedSignupConfig()}
        links={numbersConfig.links}
      />
    </div>
  );
}
