import { drizzleAdapter } from "@quami/sendo/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Sendo's storage on your own Postgres through Drizzle. Use `adapter` in lib/sendo.ts:
//   createSendo({ adapter, media, ... })
// `sendo doctor --config lib/sendo-adapter.ts` and `sendo mcp --config ...` read `adapter`
// (and `media`) from this file.
//
// Already have a Drizzle `db`? Import it instead of creating a second pool:
//   export const adapter = drizzleAdapter({ db });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** The Drizzle database Sendo uses (node-postgres). */
export const db = drizzle({ client: pool });

/** Sendo's `SendoAdapter` over the `sendo_*` tables of `DATABASE_URL`. */
export const adapter = drizzleAdapter({ db });

// Media (images, audio, documents) needs a MediaStore; there is no Supabase Storage here.
// For S3, R2 or any S3-compatible store (npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner):
//   import { S3Client } from "@aws-sdk/client-s3";
//   import { s3Storage } from "@quami/sendo/storage/s3";
//   export const media = s3Storage({ client: new S3Client({}), bucket: process.env.SENDO_MEDIA_BUCKET! });
