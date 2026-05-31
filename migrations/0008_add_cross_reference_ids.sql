-- Migration 0008: cross-reference ids to OTHER sources, alongside the row's
-- primary (external_source, external_id). A row keeps ONE source of record, but
-- can now point at its equivalent entry on other sources:
--   anilist_id  — AniList Media id (links a Bangumi-sourced anime to AniList)
--   tmdb_id     — TMDB id (kind-prefixed like external_id when set, e.g. "tv:1399")
--   igdb_id     — IGDB game id (links a Bangumi-sourced game to IGDB — Feature C)
--   bangumi_id  — Bangumi subject id (an AniList/IGDB row pointing back to Bangumi)
--
-- ADDITIVE ONLY. No backfill, no change to external_source/external_id — existing
-- rows get NULL in every new column, so nothing currently working can break. Code
-- reads "the X id of a row" via a helper that falls back to external_id when X is
-- the primary source (see src/client/lib/crossRef.ts).
--
-- These also seed PRD-v2 Features A & B: the What's New scanner needs an AniList
-- id to walk SEQUEL edges; Recommendations needs an IGDB id for similar_games.

ALTER TABLE media ADD COLUMN anilist_id TEXT;
ALTER TABLE media ADD COLUMN tmdb_id TEXT;
ALTER TABLE media ADD COLUMN igdb_id TEXT;
ALTER TABLE media ADD COLUMN bangumi_id TEXT;
