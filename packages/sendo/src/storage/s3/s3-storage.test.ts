/**
 * `s3Storage` against an S3-compatible endpoint mocked with msw (path-style, in-memory objects).
 * Isolation test of a protocol boundary: only a real S3 would reject these requests, so each way
 * the adapter can get the protocol wrong has one test. The shared `MediaStore` contract also runs
 * against the same endpoint.
 *
 * Ways it could fail:
 * 1. `put` sends the wrong bucket/key, no `Content-Type`, or altered bytes.
 * 2. `signedUrl` isn't a SigV4 presigned GetObject URL for the key with the requested TTL, leaks
 *    the secret access key, or doesn't download the object.
 * 3. `signedUrl` asks for more than SigV4's 7-day maximum (S3 rejects `X-Amz-Expires` > 604800)
 *    or a non-positive TTL instead of the default.
 * 4. `get` of a missing key (404 `NoSuchKey`) throws instead of returning `null`.
 * 5. `delete` sends more than 1000 keys in one `DeleteObjects` request (S3 rejects it) or repeats
 *    duplicate keys.
 * 6. `delete([])` sends an empty `DeleteObjects` request (S3 answers `MalformedXML`).
 * 7. `delete` swallows per-key errors that S3 reports inside a 200 response.
 * 8. `exists` reports a 403 (bad credentials) as a missing bucket, or a 404 as an error.
 * 9. A failed call surfaces without the S3 error code, or with the secret access key.
 */
import { S3Client } from "@aws-sdk/client-s3";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runMediaStoreContract } from "../../adapters/contract";
import { S3_MAX_SIGNED_URL_TTL_SEC, S3StorageError, s3Storage } from ".";

const ENDPOINT = "https://s3.test";
const BUCKET = "sendo-media";
const ACCESS_KEY = "AKIASENDOTEST";
const SECRET_KEY = "secret-sentinel-0123456789abcdef";

interface Recorded {
  method: string;
  url: URL;
  headers: Headers;
  body: Uint8Array;
}

const objects = new Map<string, { bytes: Uint8Array; contentType: string | null }>();
const requests: Recorded[] = [];
/** Keys `DeleteObjects` reports as `AccessDenied` (inside a 200 response). */
const undeletable = new Set<string>();
/** Bucket name → HeadBucket status. */
const bucketStatus = new Map<string, number>([[BUCKET, 200]]);
let putStatus = 200;

const xmlError = (status: number, code: string, message: string) =>
  new HttpResponse(
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${message}</Message></Error>`,
    {
      status,
      headers: { "content-type": "application/xml" },
    },
  );

const unescapeXml = (value: string) =>
  value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

const server = setupServer(
  http.all(`${ENDPOINT}/*`, async ({ request }) => {
    const url = new URL(request.url);
    const body = new Uint8Array(await request.arrayBuffer());
    requests.push({ method: request.method, url, headers: request.headers, body });
    const [bucket = "", ...rest] = url.pathname.slice(1).split("/");
    const key = rest.map(decodeURIComponent).join("/");

    if (request.method === "HEAD" && key === "") {
      return new HttpResponse(null, { status: bucketStatus.get(bucket) ?? 404 });
    }
    if (bucket !== BUCKET) return xmlError(404, "NoSuchBucket", "The bucket does not exist");
    if (request.method === "PUT") {
      if (putStatus !== 200) return xmlError(putStatus, "AccessDenied", "Access Denied");
      objects.set(key, { bytes: body, contentType: request.headers.get("content-type") });
      return new HttpResponse(null, { status: 200, headers: { etag: '"etag"' } });
    }
    if (request.method === "GET") {
      const object = objects.get(key);
      if (!object) return xmlError(404, "NoSuchKey", "The specified key does not exist.");
      return new HttpResponse(object.bytes.slice(), {
        status: 200,
        headers: { "content-type": object.contentType ?? "application/octet-stream" },
      });
    }
    if (request.method === "POST" && url.searchParams.has("delete")) {
      const xml = new TextDecoder().decode(body);
      const keys = [...xml.matchAll(/<Key>(.*?)<\/Key>/g)].map((m) => unescapeXml(m[1] ?? ""));
      if (keys.length === 0 || keys.length > 1000) {
        return xmlError(400, "MalformedXML", "The XML you provided was not well-formed");
      }
      const errors = keys
        .filter((k) => undeletable.has(k))
        .map(
          (k) =>
            `<Error><Key>${k}</Key><Code>AccessDenied</Code><Message>Access Denied</Message></Error>`,
        );
      for (const k of keys) if (!undeletable.has(k)) objects.delete(k);
      return new HttpResponse(
        `<?xml version="1.0" encoding="UTF-8"?><DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${errors.join("")}</DeleteResult>`,
        { status: 200, headers: { "content-type": "application/xml" } },
      );
    }
    return xmlError(405, "MethodNotAllowed", "Not supported by the mock");
  }),
);

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});
afterEach(() => {
  objects.clear();
  requests.length = 0;
  undeletable.clear();
  bucketStatus.clear();
  bucketStatus.set(BUCKET, 200);
  putStatus = 200;
});
afterAll(() => {
  server.close();
});

function client() {
  return new S3Client({
    region: "us-east-1",
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    maxAttempts: 1,
  });
}

const store = (bucket = BUCKET) => s3Storage({ client: client(), bucket });
const deleteRequests = () =>
  requests.filter((r) => r.method === "POST" && r.url.searchParams.has("delete"));

runMediaStoreContract("s3Storage (msw S3 endpoint)", () => store());

describe("s3Storage protocol boundary", () => {
  it("1. put sends the bucket, key, content type and exact bytes", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2]);
    await store().put("tenant-a/acc/conv/300000000000001.jpg", bytes, "image/jpeg");

    const put = requests.find((r) => r.method === "PUT");
    expect(put?.url.pathname).toBe(`/${BUCKET}/tenant-a/acc/conv/300000000000001.jpg`);
    expect(put?.headers.get("content-type")).toBe("image/jpeg");
    expect(put?.headers.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIASENDOTEST\//,
    );
    expect(Array.from(objects.get("tenant-a/acc/conv/300000000000001.jpg")?.bytes ?? [])).toEqual(
      Array.from(bytes),
    );
  });

  it("2. signedUrl is a SigV4 presigned GetObject URL that downloads the object", async () => {
    const s3 = store();
    await s3.put("t/a/c/doc 1.pdf", new Uint8Array([37, 80, 68, 70]), "application/pdf");

    const url = new URL(await s3.signedUrl("t/a/c/doc 1.pdf", 300));
    expect(`${url.origin}${url.pathname}`).toBe(`${ENDPOINT}/${BUCKET}/t/a/c/doc%201.pdf`);
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Credential")).toMatch(
      /^AKIASENDOTEST\/\d{8}\/us-east-1\/s3\/aws4_request$/,
    );
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.href).not.toContain(SECRET_KEY);

    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([37, 80, 68, 70]);
  });

  it("3. signedUrl clamps the TTL to 7 days and defaults non-positive TTLs to 3600 s", async () => {
    const s3 = store();
    const expires = async (ttl: number) =>
      new URL(await s3.signedUrl("k.jpg", ttl)).searchParams.get("X-Amz-Expires");
    expect(await expires(30 * 24 * 3600)).toBe(String(S3_MAX_SIGNED_URL_TTL_SEC));
    expect(await expires(0)).toBe("3600");
    expect(await expires(-5)).toBe("3600");
    expect(await expires(299.2)).toBe("300");
  });

  it("4. get of a missing key is null", async () => {
    expect(await store().get("nope/missing.jpg")).toBeNull();
    expect(requests.at(-1)?.method).toBe("GET");
  });

  it("5. delete batches at most 1000 keys per request and sends each key once", async () => {
    const keys = Array.from({ length: 2101 }, (_, i) => `t/a/c/${String(i)}.jpg`);
    for (const key of keys.slice(0, 3))
      objects.set(key, { bytes: new Uint8Array([1]), contentType: null });

    await store().delete([...keys, keys[0] ?? "", keys[1] ?? ""]);

    const sizes = deleteRequests().map(
      (r) => [...new TextDecoder().decode(r.body).matchAll(/<Key>/g)].length,
    );
    expect(sizes).toEqual([1000, 1000, 101]);
    expect(objects.size).toBe(0);
  });

  it("6. delete([]) sends nothing", async () => {
    await store().delete([]);
    expect(requests).toEqual([]);
  });

  it("7. delete throws when S3 reports per-key errors in a 200 response", async () => {
    objects.set("t/keep.jpg", { bytes: new Uint8Array([1]), contentType: null });
    undeletable.add("t/keep.jpg");
    const error = await store()
      .delete(["t/keep.jpg", "t/other.jpg"])
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(S3StorageError);
    expect(error).toMatchObject({ operation: "storage.delete", code: "AccessDenied" });
    expect(objects.has("t/keep.jpg")).toBe(true);
  });

  it("8. exists: 200 → true, 404 → false, 403 → throws", async () => {
    bucketStatus.set("missing-bucket", 404);
    bucketStatus.set("forbidden-bucket", 403);
    expect(await store().exists?.()).toBe(true);
    expect(await store("missing-bucket").exists?.()).toBe(false);
    await expect(store("forbidden-bucket").exists?.()).rejects.toMatchObject({
      name: "S3StorageError",
      operation: "storage.exists",
      status: 403,
    });
  });

  it("9. failures carry the operation and S3 code, never the secret key", async () => {
    putStatus = 403;
    const error = await store()
      .put("t/a.jpg", new Uint8Array([1]), "image/jpeg")
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(error).toBeInstanceOf(S3StorageError);
    expect(error).toMatchObject({ operation: "storage.put", code: "AccessDenied", status: 403 });
    expect(String(error)).toContain("AccessDenied");
    expect(JSON.stringify(error)).not.toContain(SECRET_KEY);
    expect(String(error)).not.toContain(SECRET_KEY);
  });
});
