// IGDB (Internet Game Database) client. Like TMDB this runs in the WORKER, not
// the browser: IGDB requires a Twitch-issued OAuth token, and the project rule
// is that secret-bearing sources stay server-side (PLAN.md §400). Auth is a
// two-step dance — get an app token from Twitch (client_credentials), then send
// it plus the Twitch Client-ID on every IGDB call.
//
// IGDB's query language is "Apicalypse": a POST body of `field; field; clauses;`
// statements (no JSON query). Field expansion uses dot paths (cover.image_id),
// so one request returns the nested data the mapper needs.
//
// The Twitch token lasts ~60 days; we cache it module-side and refresh on expiry
// (or a 401). Cache is best-effort across the isolate's lifetime — a cold isolate
// just fetches a fresh token.

const TWITCH_TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const IGDB_BASE = "https://api.igdb.com/v4";

// Cover art. t_cover_big is 264×374 — plenty for our card size; the R2 re-host
// pipeline then caches whatever we hand it.
const IGDB_IMAGE_BASE = "https://images.igdb.com/igdb/image/upload/t_cover_big";

const DEFAULT_RETRIES = 2;
const DEFAULT_BACKOFF_MS = 300;

// A game's platform as IGDB returns it (id + display name + short abbreviation).
export interface IgdbPlatform {
  id: number;
  name?: string;
  abbreviation?: string;
}

// A company involved with a game (developer / publisher / …). `country` is an
// ISO 3166-1 *numeric* code (e.g. 392 = Japan) — used to derive a game's region.
export interface IgdbInvolvedCompany {
  developer?: boolean;
  publisher?: boolean;
  company?: { id: number; country?: number | null } | null;
}

// The subset of IGDB's game shape we consume. `cover.image_id` builds the cover
// URL; `first_release_date` is a Unix timestamp (seconds). `involved_companies`
// is fetched on detail only (the mapper reads the developer's country → region).
export interface IgdbGame {
  id: number;
  name: string;
  cover?: { id: number; image_id?: string } | null;
  first_release_date?: number | null;
  platforms?: IgdbPlatform[];
  involved_companies?: IgdbInvolvedCompany[];
  summary?: string;
}

export interface IgdbClientOptions {
  /** Twitch app Client ID (also sent as the IGDB Client-ID header). Required. */
  clientId: string;
  /** Twitch app Client Secret — used once to mint the token. Required. */
  clientSecret: string;
  /** Override fetch (tests). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Retries on HTTP 429. Defaults to 2. */
  retries?: number;
  /** Initial backoff in ms, doubles per retry. Defaults to 300. */
  backoffMs?: number;
}

export class IgdbError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "IgdbError";
  }
}

/** Full cover URL from an IGDB `image_id` (or null). */
export function igdbCoverUrl(imageId: string | null | undefined): string | null {
  return imageId ? `${IGDB_IMAGE_BASE}/${imageId}.jpg` : null;
}

// --- Twitch token (cached) -------------------------------------------------

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}
let cachedToken: CachedToken | null = null;

/** Drop the cached Twitch token. Exported for tests (cache is module-global). */
export function resetIgdbTokenCache(): void {
  cachedToken = null;
}

async function getTwitchToken(options: IgdbClientOptions): Promise<string> {
  const now = Date.now();
  // Reuse a token that still has >1 min of life (guard against clock skew / the
  // request taking a moment).
  if (cachedToken && cachedToken.expiresAt > now + 60_000) {
    return cachedToken.token;
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const params = new URLSearchParams({
    client_id: options.clientId,
    client_secret: options.clientSecret,
    grant_type: "client_credentials",
  });
  const response = await fetchImpl(`${TWITCH_TOKEN_URL}?${params.toString()}`, {
    method: "POST",
  });
  if (!response.ok) {
    throw new IgdbError(
      `Twitch token request failed: HTTP ${response.status}`,
      response.status,
    );
  }
  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

// --- IGDB queries ----------------------------------------------------------

const GAME_FIELDS =
  "name,cover.image_id,first_release_date,platforms.name,platforms.abbreviation";

export async function searchIgdb(
  query: string,
  options: IgdbClientOptions & { limit?: number } = {} as IgdbClientOptions,
): Promise<IgdbGame[]> {
  const limit = options.limit ?? 25;
  // Escape embedded quotes/backslashes so the apicalypse `search "…"` stays valid.
  const safe = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const body = `search "${safe}"; fields ${GAME_FIELDS}; limit ${limit};`;
  return igdbRequest(body, options);
}

export async function getIgdbDetail(
  id: number,
  options: IgdbClientOptions,
): Promise<IgdbGame | null> {
  // Detail also pulls the involved companies' developer flag + country, so the
  // mapper can derive a region (the developer's country) for the game.
  const body =
    `fields ${GAME_FIELDS},summary,` +
    `involved_companies.developer,involved_companies.publisher,involved_companies.company.country;` +
    ` where id = ${id};`;
  const results = await igdbRequest(body, options);
  return results[0] ?? null;
}

async function igdbRequest(
  body: string,
  options: IgdbClientOptions,
): Promise<IgdbGame[]> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  let attempt = 0;
  let refreshedOn401 = false;
  while (true) {
    const token = await getTwitchToken(options);
    const response = await fetchImpl(`${IGDB_BASE}/games`, {
      method: "POST",
      headers: {
        "Client-ID": options.clientId,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      body,
    });

    // 401 → the token went stale; drop it and retry once with a fresh one.
    if (response.status === 401 && !refreshedOn401) {
      resetIgdbTokenCache();
      refreshedOn401 = true;
      continue;
    }

    if (response.status === 429 && attempt < retries) {
      await sleep(backoffMs * 2 ** attempt);
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      throw new IgdbError(
        `IGDB request failed: HTTP ${response.status}`,
        response.status,
      );
    }

    return (await response.json()) as IgdbGame[];
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
