import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DEV_USER_EMAIL, DEV_USER_PASSWORD, playgroundMode } from "@/lib/playground-env";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default function LoginPage() {
  if (playgroundMode() === "fixtures") redirect("/");

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Entrar al playground</CardTitle>
          <CardDescription>
            Usuario de desarrollo: <code>{DEV_USER_EMAIL}</code> / <code>{DEV_USER_PASSWORD}</code>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm defaultEmail={DEV_USER_EMAIL} />
        </CardContent>
      </Card>
    </main>
  );
}
