import Link from "next/link";
import { signOut } from "@/app/actions";
import { ThemeToggle } from "@/components/site/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { playground } from "@/lib/sendo";

export const dynamic = "force-dynamic";

const MODE_LABEL = {
  fixtures: "Fixtures (memoria, sin Docker)",
  supabase: "Supabase local",
} as const;

export default async function HomePage() {
  const user = await requireUser();
  await playground.ready;
  const conversations = await playground.sendo.inbox.list({ tenantId: user.tenantId, limit: 100 });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 md:p-8">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">sendo playground</h1>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <form action={signOut}>
            <Button type="submit" variant="outline" size="sm" className="active:bg-accent/70">
              Salir
            </Button>
          </form>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Estado</CardTitle>
          <CardDescription>Webhook en /api/sendo/webhook</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Modo</dt>
            <dd>{MODE_LABEL[playground.mode]}</dd>
            <dt className="text-muted-foreground">Modelo</dt>
            <dd>
              {playground.mockModel ? "Modelo de prueba (determinista)" : "SENDO_AGENT_MODEL"}
            </dd>
            <dt className="text-muted-foreground">Usuario</dt>
            <dd className="truncate">{user.userId}</dd>
            <dt className="text-muted-foreground">Tenant</dt>
            <dd className="truncate font-mono text-xs leading-5">{user.tenantId}</dd>
            <dt className="text-muted-foreground">Conversaciones</dt>
            <dd>{conversations.items.length}</dd>
          </dl>
        </CardContent>
      </Card>

      <Button asChild variant="secondary" className="self-start active:bg-secondary/70">
        <Link href="/inbox">Abrir bandeja de WhatsApp</Link>
      </Button>
    </main>
  );
}
