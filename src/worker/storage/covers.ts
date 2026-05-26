// Cover-image upload pipeline: fetch an upstream image URL → put to R2 →
// return a publicly-fetchable URL. Idempotent on (externalSource, externalId)
// so a re-run with the same key skips the network fetch entirely.
//
// Graceful degradation: if the upstream fetch fails (404, network error, etc.)
// we return the original `sourceUrl` so the calling row still has *some*
// cover URL — the AniList CDN is publicly hot-linkable. The caller stores
// whatever we return in `media.cover_url`; if it's an upstream URL, that's
// just a degraded version of the normal case where it's an R2 URL.

export interface CoverEnv {
  COVERS: R2Bucket;
  COVERS_PUBLIC_URL_BASE: string;
}

export interface CoverKey {
  externalSource: string;
  externalId: string;
}

export interface UploadCoverOptions {
  /** Override the global fetch (used in tests). */
  fetch?: typeof globalThis.fetch;
}

const DEFAULT_EXTENSION = "jpg";
const DEFAULT_CONTENT_TYPE = "image/jpeg";
// Only allow extensions we'd realistically receive from a cover-art CDN.
// Anything else falls back to .jpg so we never end up with bizarre R2 keys
// like `covers/anilist/101922.php` from a malformed URL.
const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export async function uploadCoverToR2(
  env: CoverEnv,
  sourceUrl: string,
  key: CoverKey,
  options: UploadCoverOptions = {},
): Promise<string> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const objectKey = buildObjectKey(key, sourceUrl);
  const publicUrl = buildPublicUrl(env, objectKey);

  // Idempotency: if the object already exists, skip the fetch+put entirely.
  // R2's `head()` is a single HEAD request — cheaper than blind put.
  const existing = await env.COVERS.head(objectKey);
  if (existing !== null) {
    return publicUrl;
  }

  let response: Response;
  try {
    response = await fetchImpl(sourceUrl);
  } catch {
    // Network error reaching upstream — return the upstream URL as a fallback
    // so the row still renders something. Per PLAN.md acceptance: "Upstream
    // 404s don't break the flow — fallback URL is returned."
    return sourceUrl;
  }

  if (!response.ok) {
    return sourceUrl;
  }

  const contentType = response.headers.get("content-type") ?? DEFAULT_CONTENT_TYPE;
  const bytes = await response.arrayBuffer();

  await env.COVERS.put(objectKey, bytes, {
    httpMetadata: { contentType },
  });

  return publicUrl;
}

function buildObjectKey(key: CoverKey, sourceUrl: string): string {
  const ext = inferExtension(sourceUrl);
  return `covers/${key.externalSource}/${key.externalId}.${ext}`;
}

function inferExtension(url: string): string {
  // Strip query string + fragment, then take the chars after the last dot of
  // the path component. AniList URLs look like `bx101922-WBsBl0ClmgYL.jpg`;
  // some other sources append `?v=12345` cache-busters which we ignore.
  const pathOnly = url.split(/[?#]/)[0] ?? "";
  const dotIndex = pathOnly.lastIndexOf(".");
  if (dotIndex === -1) return DEFAULT_EXTENSION;

  const candidate = pathOnly.slice(dotIndex + 1).toLowerCase();
  return ALLOWED_EXTENSIONS.has(candidate) ? candidate : DEFAULT_EXTENSION;
}

function buildPublicUrl(env: CoverEnv, objectKey: string): string {
  const base = env.COVERS_PUBLIC_URL_BASE.replace(/\/$/, "");
  return `${base}/${objectKey}`;
}
