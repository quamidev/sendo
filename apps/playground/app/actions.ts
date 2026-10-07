"use server";

import { redirect } from "next/navigation";
import { playgroundMode } from "@/lib/playground-env";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SignInState {
  error: string | null;
}

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  if (playgroundMode() === "fixtures") redirect("/");
  const email = formData.get("email");
  const password = formData.get("password");
  if (
    typeof email !== "string" ||
    typeof password !== "string" ||
    email === "" ||
    password === ""
  ) {
    return { error: "Escribe tu correo y contraseña." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error !== null) return { error: "Correo o contraseña incorrectos." };
  redirect("/");
}

export async function signOut(): Promise<void> {
  if (playgroundMode() === "supabase") {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}
