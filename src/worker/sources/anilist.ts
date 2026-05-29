// AniList GraphQL client. Two operations: search by title, fetch detail by id.
// Hand-written GraphQL strings + raw fetch — two queries don't justify a
// graphql-request / urql dependency.

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

// Default retry budget for HTTP 429 (AniList caps at ~90 req/min globally).
const DEFAULT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1000;

export type AniListMediaType = "ANIME" | "MANGA";

export type AniListFormat =
  | "TV"
  | "TV_SHORT"
  | "MOVIE"
  | "SPECIAL"
  | "OVA"
  | "ONA"
  | "MUSIC"
  | "MANGA"
  | "NOVEL"
  | "ONE_SHOT";

export type AniListSeason = "WINTER" | "SPRING" | "SUMMER" | "FALL";

export interface AniListMedia {
  id: number;
  // ANIME | MANGA — the classifier fallback when `format` is null (e.g. a
  // NOT_YET_RELEASED title). Optional so older captured fixtures still type-check.
  type?: AniListMediaType | null;
  title: {
    romaji: string | null;
    english: string | null;
    native: string | null;
  };
  coverImage: {
    extraLarge: string | null;
  };
  format: AniListFormat | null;
  episodes: number | null;
  chapters: number | null;
  volumes: number | null;
  season: AniListSeason | null;
  seasonYear: number | null;
  countryOfOrigin: string | null; // ISO-3166 alpha-2, e.g. "JP", "CN", "KR"
}

interface GraphQLError {
  message: string;
  status?: number;
  locations?: unknown;
}

interface AniListGraphQLResponse<T> {
  data: T | null;
  errors?: GraphQLError[];
}

const MEDIA_FIELDS = `
  id
  type
  title { romaji english native }
  coverImage { extraLarge }
  format
  episodes
  chapters
  volumes
  season
  seasonYear
  countryOfOrigin
`;

const SEARCH_QUERY = `
  query ($search: String!, $type: MediaType!, $perPage: Int!) {
    Page(perPage: $perPage) {
      media(search: $search, type: $type) {${MEDIA_FIELDS}}
    }
  }
`;

const DETAIL_QUERY = `
  query ($id: Int!, $type: MediaType!) {
    Media(id: $id, type: $type) {${MEDIA_FIELDS}}
  }
`;

// Only the relation fields the auto-grouping needs: the edge's relationType
// (SEQUEL / PREQUEL / …) and the neighbour's id + format (to keep linking to
// season-like TV entries, not recap movies / OVAs / spin-offs).
const RELATIONS_QUERY = `
  query ($id: Int!) {
    Media(id: $id) {
      relations {
        edges {
          relationType
          node { id type format }
        }
      }
    }
  }
`;

// A single relation edge from a Media's `relations` connection. relationType is
// AniList's RelationType enum (SEQUEL | PREQUEL | SIDE_STORY | ALTERNATIVE | …);
// we keep it a string since we only switch on a couple of values.
export interface AniListRelationEdge {
  relationType: string;
  node: {
    id: number;
    type: AniListMediaType | null;
    format: AniListFormat | null;
  };
}

export interface AniListClientOptions {
  /** Override fetch (used in tests). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Retries on HTTP 429. Defaults to 3. */
  retries?: number;
  /** Initial backoff in ms, doubles per retry. Defaults to 1000. */
  backoffMs?: number;
}

export class AniListError extends Error {
  constructor(
    message: string,
    readonly graphqlErrors?: unknown,
  ) {
    super(message);
    this.name = "AniListError";
  }
}

export async function searchAniList(
  query: string,
  type: AniListMediaType,
  options: AniListClientOptions & { perPage?: number } = {},
): Promise<AniListMedia[]> {
  const response = await graphqlRequest<{ Page: { media: AniListMedia[] } }>(
    SEARCH_QUERY,
    { search: query, type, perPage: options.perPage ?? 10 },
    options,
  );
  return response.Page.media;
}

export async function getAniListDetail(
  id: number,
  type: AniListMediaType,
  options: AniListClientOptions = {},
): Promise<AniListMedia | null> {
  const response = await graphqlRequest<{ Media: AniListMedia | null }>(
    DETAIL_QUERY,
    { id, type },
    options,
  );
  return response.Media;
}

/**
 * Fetch a media's relation edges (SEQUEL / PREQUEL / …). Runs in the browser
 * like the other AniList calls. Returns [] when the id has no relations (or the
 * Media is null). Used by the series auto-grouping: when adding an anime whose
 * sequel/prequel TV entry is already in the library, link it into that series.
 */
export async function getAniListRelations(
  id: number,
  options: AniListClientOptions = {},
): Promise<AniListRelationEdge[]> {
  const response = await graphqlRequest<{
    Media: { relations?: { edges?: AniListRelationEdge[] } } | null;
  }>(RELATIONS_QUERY, { id }, options);
  return response.Media?.relations?.edges ?? [];
}

async function graphqlRequest<T>(
  query: string,
  variables: Record<string, unknown>,
  options: AniListClientOptions,
): Promise<T> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;

  let attempt = 0;
  // Retry loop covers HTTP 429 only; other errors surface immediately so we
  // don't hammer AniList with a broken request.
  while (true) {
    // Runs in the BROWSER (not the Worker): AniList blocks Cloudflare Worker
    // egress IPs, but allows CORS, so the client calls it directly.
    const response = await fetchImpl(ANILIST_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (response.status === 429 && attempt < retries) {
      // AniList sends Retry-After in seconds; fall back to exponential backoff.
      const retryAfterHeader = response.headers.get("Retry-After");
      const retryAfterMs = retryAfterHeader
        ? Number.parseFloat(retryAfterHeader) * 1000
        : backoffMs * 2 ** attempt;
      await sleep(retryAfterMs);
      attempt += 1;
      continue;
    }

    if (!response.ok) {
      throw new AniListError(
        `AniList request failed: HTTP ${response.status}`,
      );
    }

    const payload = (await response.json()) as AniListGraphQLResponse<T>;
    if (payload.errors && payload.errors.length > 0) {
      throw new AniListError(
        `AniList returned GraphQL errors: ${payload.errors
          .map((e) => e.message)
          .join("; ")}`,
        payload.errors,
      );
    }
    if (payload.data === null) {
      throw new AniListError("AniList returned a null data field");
    }
    return payload.data;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
