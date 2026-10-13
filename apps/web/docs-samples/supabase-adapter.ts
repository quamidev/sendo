// #region supabase
import { supabaseAdapter } from "@quami/sendo/adapters/supabase";
import { createClient } from "@supabase/supabase-js";

// The SERVICE ROLE client (bypasses RLS). Server only.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);

export const adapter = supabaseAdapter(supabaseAdmin, {
  storageBucket: "sendo-media", // private bucket
  signedUrlTtlSec: 300,
});
// #endregion supabase
