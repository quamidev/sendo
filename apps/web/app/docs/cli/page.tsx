import type { Metadata } from "next";
import { Callout } from "@/components/docs/callout";
import { CodeBlock, Sample } from "@/components/docs/code-block";
import { DocPage } from "@/components/docs/doc-page";
import { Heading } from "@/components/docs/heading";
import { A, C, List, P } from "@/components/docs/prose";
import { Table } from "@/components/docs/table";

export const metadata: Metadata = { title: "CLI" };

const toc = [
  { id: "env", title: "Environment" },
  { id: "doctor", title: "doctor" },
  { id: "checks", title: "doctor checks" },
  { id: "accounts-add", title: "accounts add" },
  { id: "exit-codes", title: "Exit codes" },
  { id: "programmatic", title: "Programmatic use" },
] as const;

export default function CliPage() {
  return (
    <DocPage slug="cli" toc={toc}>
      <P>
        The package ships a <C>wa-li</C> binary. Run it from your app&rsquo;s root with{" "}
        <C>npx @quami/wa-li &lt;command&gt;</C> (or <C>npx wa-li</C> once installed). Output is
        in Spanish; <C>--help</C> lists every flag.
      </P>
      <CodeBlock
        title="usage"
        code={`wa-li doctor [--account <id>] [--url <url>] [--json]
wa-li accounts add [--phone-number-id <id>] [--waba-id <id>] [--token-env <VAR>]
                   [--tenant-id <uuid>] [--display-phone <número>] [--timezone <IANA>] [--yes]
wa-li --help | --version`}
      />

      <Heading id="env">Environment</Heading>
      <P>
        Both commands load <C>.env.development.local</C>, <C>.env.local</C> and <C>.env</C> from
        the current directory, in that order, without overriding variables already set in the
        shell. To check production values, export them or run the command where they are defined.
      </P>
      <Table
        head={["Variable", "Used for"]}
        rows={[
          [<C key="v">WA_APP_SECRET</C>, "Required (env check)."],
          [<C key="v">WA_VERIFY_TOKEN</C>, "Required; also used for the --url challenge."],
          [<C key="v">SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL</C>, "Supabase project URL."],
          [<C key="v">SUPABASE_SERVICE_ROLE_KEY</C>, "Reads wa_accounts, schema and storage; accounts add inserts with it."],
          [<C key="v">WA_STORAGE_BUCKET</C>, "Bucket to check. Default whatsapp-media."],
          [<C key="v">{"<token_ref>"}</C>, "One per account, e.g. WA_TOKEN_MAIN. Must be set locally for doctor and accounts add."],
          [<C key="v">WA_APP_ID</C>, "Optional. When set, doctor also checks this app is in the WABA's subscribed apps."],
        ]}
      />
      <Callout>
        <p>
          Values of <C>WA_APP_SECRET</C>, <C>WA_VERIFY_TOKEN</C>, <C>SUPABASE_SERVICE_ROLE_KEY</C>{" "}
          and every resolved token, plus any env var whose name contains TOKEN, SECRET, KEY or
          PASSWORD, are scrubbed from the output.
        </p>
      </Callout>

      <Heading id="doctor">doctor</Heading>
      <CodeBlock
        title="shell"
        code={`npx @quami/wa-li doctor
npx @quami/wa-li doctor --account 123456789012345        # one account (id or phone_number_id)
npx @quami/wa-li doctor --url https://<app>/api/whatsapp # also test the webhook challenge
npx @quami/wa-li doctor --json                           # machine-readable results`}
      />
      <P>
        Prints a pass/fail table with a fix hint under each failure. Checks never throw: a broken
        step is reported and the rest still run.
      </P>

      <Heading id="checks">doctor checks</Heading>
      <Table
        head={["id", "Passes when", "Typical fix"]}
        rows={[
          [<C key="i">env</C>, "WA_APP_SECRET, WA_VERIFY_TOKEN, Supabase URL + service role key and every account's token_ref are set.", "Add them to .env.local / the deployment."],
          [<C key="i">tables</C>, "All wa_* tables exist.", "Apply the wa-li-schema migration."],
          [<C key="i">schema-version</C>, "wa_schema_meta matches the package (WA_SCHEMA_VERSION).", "Apply the latest migration."],
          [<C key="i">storage</C>, "The WA_STORAGE_BUCKET bucket exists.", "Create a private bucket."],
          [<C key="i">accounts</C>, "At least one active wa_accounts row.", "npx @quami/wa-li accounts add"],
          [<C key="i">{"account:<phone_number_id>:token"}</C>, "Reported (failing) only when the token env var is empty.", "Set the variable named by token_ref."],
          [<C key="i">{"account:<phone_number_id>:phone"}</C>, "GET /{phone_number_id} works with the token; shows verification status and quality rating. RED quality fails.", "Token expired (190) or wrong phone_number_id."],
          [<C key="i">{"account:<phone_number_id>:subscription"}</C>, "GET /{waba_id}/subscribed_apps lists at least one app (and WA_APP_ID, if set).", "POST /{waba_id}/subscribed_apps; subscribe the messages field."],
          [<C key="i">{"account:<phone_number_id>:templates"}</C>, "Templates can be listed from Meta (counts approved ones).", "Token needs whatsapp_business_management."],
          [<C key="i">webhook-url</C>, "Only with --url: the GET verify challenge echoes the challenge with WA_VERIFY_TOKEN.", "Deploy the route, align WA_VERIFY_TOKEN."],
        ]}
      />
      <P>
        The template check lists templates from Meta; it doesn&rsquo;t write <C>wa_templates</C>.
        Your app populates that table with <C>wa.templates.sync()</C>.
      </P>

      <Heading id="accounts-add">accounts add</Heading>
      <CodeBlock
        title="shell"
        code={`# interactive (prompts for anything missing)
npx @quami/wa-li accounts add

# non-interactive
npx @quami/wa-li accounts add --phone-number-id 123456789012345 --token-env WA_TOKEN_MAIN \\
  --waba-id 987654321098765 --tenant-id <uuid> --display-phone "+502 5555 1234" \\
  --timezone America/Guatemala --yes`}
      />
      <Table
        head={["Flag", "Notes"]}
        rows={[
          [<C key="f">--phone-number-id</C>, "Required. Meta Phone number ID."],
          [<C key="f">--token-env</C>, "Required. Name of the env var with the token; it must be set and non-empty, or the command stops before calling Meta."],
          [<C key="f">--waba-id</C>, "Optional. Looked up from the token's debug_token scopes when there's a single candidate; otherwise asked for."],
          [<C key="f">--display-phone</C>, "Optional. Fetched from Meta by default."],
          [<C key="f">--tenant-id</C>, "Optional uuid. Default: no tenant (null)."],
          [<C key="f">--timezone</C>, "Optional IANA zone. Default America/Guatemala."],
          [<C key="f">--yes, -y</C>, "No prompts; fail if a required value is missing. Prompts only happen on a TTY."],
        ]}
      />
      <P>
        It inserts the row through the Supabase adapter and stores only the env var name in{" "}
        <C>token_ref</C>. An existing <C>phone_number_id</C> fails with{" "}
        <C>DuplicateAccountError</C>. To change a row later, edit <C>wa_accounts</C> directly.
      </P>

      <Heading id="exit-codes">Exit codes</Heading>
      <Table
        head={["Code", "Meaning"]}
        rows={[
          ["0", "Every check passed / account added."],
          ["1", "At least one check failed, or the command failed."],
          ["2", "Usage error (unknown command or flag)."],
        ]}
      />

      <Heading id="programmatic">Programmatic use</Heading>
      <P>
        <C>runDoctor</C>, <C>doctorExitCode</C>, <C>addAccount</C> and{" "}
        <C>findWabaIdsForToken</C> are exported from <C>@quami/wa-li</C>:
      </P>
      <Sample file="doctor-programmatic.ts" region="programmatic" title="ts" />
      <List>
        <li>
          Each result is <C>{"{ id, label, ok, detail, hint? }"}</C>; <C>detail</C> and{" "}
          <C>hint</C> never contain secrets.
        </li>
        <li>
          Setup walkthrough: <A href="/docs/quickstart#doctor">Quickstart step 8</A>.
        </li>
      </List>
    </DocPage>
  );
}
