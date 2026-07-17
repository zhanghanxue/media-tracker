-- Migration number: 0011 	 2026-07-17
--
-- Canonicalize stored genres to ONE Chinese name per concept (user decision):
-- the library mixes Bangumi rows (Chinese genre names) with AniList/IGDB/TMDB
-- rows (English), so the per-type genre facets showed duplicates like
-- "Action" / "动作". This rewrites every English genre token that has a
-- canonical Chinese form; the mapper-side CANONICAL_ZH map
-- (src/worker/sources/genres.ts) applies the same mapping to all future adds.
--
-- Storage format is the sentinel-delimited `|A|B|C|` string (migration 0004),
-- so REPLACE on the pipe-wrapped token rewrites exactly one whole genre:
-- adjacent tokens share a pipe and the replacement restores it
-- (`|Action|Adventure|` → `|动作|Adventure|`). English names with no
-- established Chinese counterpart (MOBA, 4X, Ecchi, …) are left unchanged.
--
-- Raw (pre-CLEANUP) source forms first — defensive, in case any early row was
-- stored before the cleanup map existed.
UPDATE media SET genres = REPLACE(genres, '|Role-playing (RPG)|', '|角色扮演|') WHERE genres LIKE '%|Role-playing (RPG)|%';
UPDATE media SET genres = REPLACE(genres, '|Turn-based strategy (TBS)|', '|策略|') WHERE genres LIKE '%|Turn-based strategy (TBS)|%';
UPDATE media SET genres = REPLACE(genres, '|Real Time Strategy (RTS)|', '|策略|') WHERE genres LIKE '%|Real Time Strategy (RTS)|%';
UPDATE media SET genres = REPLACE(genres, '|Hack and slash/Beat ''em up|', '|砍杀|') WHERE genres LIKE '%|Hack and slash/Beat ''em up|%';
UPDATE media SET genres = REPLACE(genres, '|Science Fiction|', '|科幻|') WHERE genres LIKE '%|Science Fiction|%';
UPDATE media SET genres = REPLACE(genres, '|Science fiction|', '|科幻|') WHERE genres LIKE '%|Science fiction|%';

-- Shared across AniList / IGDB / TMDB.
UPDATE media SET genres = REPLACE(genres, '|Action & Adventure|', '|动作冒险|') WHERE genres LIKE '%|Action & Adventure|%';
UPDATE media SET genres = REPLACE(genres, '|Sci-Fi & Fantasy|', '|科幻奇幻|') WHERE genres LIKE '%|Sci-Fi & Fantasy|%';
UPDATE media SET genres = REPLACE(genres, '|Action|', '|动作|') WHERE genres LIKE '%|Action|%';
UPDATE media SET genres = REPLACE(genres, '|Adventure|', '|冒险|') WHERE genres LIKE '%|Adventure|%';
UPDATE media SET genres = REPLACE(genres, '|Comedy|', '|喜剧|') WHERE genres LIKE '%|Comedy|%';
UPDATE media SET genres = REPLACE(genres, '|Drama|', '|剧情|') WHERE genres LIKE '%|Drama|%';
UPDATE media SET genres = REPLACE(genres, '|Fantasy|', '|奇幻|') WHERE genres LIKE '%|Fantasy|%';
UPDATE media SET genres = REPLACE(genres, '|Horror|', '|恐怖|') WHERE genres LIKE '%|Horror|%';
UPDATE media SET genres = REPLACE(genres, '|Mystery|', '|悬疑|') WHERE genres LIKE '%|Mystery|%';
UPDATE media SET genres = REPLACE(genres, '|Romance|', '|爱情|') WHERE genres LIKE '%|Romance|%';
UPDATE media SET genres = REPLACE(genres, '|Sci-Fi|', '|科幻|') WHERE genres LIKE '%|Sci-Fi|%';
UPDATE media SET genres = REPLACE(genres, '|Thriller|', '|惊悚|') WHERE genres LIKE '%|Thriller|%';
UPDATE media SET genres = REPLACE(genres, '|Music|', '|音乐|') WHERE genres LIKE '%|Music|%';
UPDATE media SET genres = REPLACE(genres, '|Crime|', '|犯罪|') WHERE genres LIKE '%|Crime|%';
UPDATE media SET genres = REPLACE(genres, '|History|', '|历史|') WHERE genres LIKE '%|History|%';
UPDATE media SET genres = REPLACE(genres, '|Historical|', '|历史|') WHERE genres LIKE '%|Historical|%';
UPDATE media SET genres = REPLACE(genres, '|War|', '|战争|') WHERE genres LIKE '%|War|%';
UPDATE media SET genres = REPLACE(genres, '|Warfare|', '|战争|') WHERE genres LIKE '%|Warfare|%';
UPDATE media SET genres = REPLACE(genres, '|War & Politics|', '|战争|') WHERE genres LIKE '%|War & Politics|%';
UPDATE media SET genres = REPLACE(genres, '|Family|', '|家庭|') WHERE genres LIKE '%|Family|%';
UPDATE media SET genres = REPLACE(genres, '|Documentary|', '|纪录片|') WHERE genres LIKE '%|Documentary|%';
UPDATE media SET genres = REPLACE(genres, '|Western|', '|西部|') WHERE genres LIKE '%|Western|%';
UPDATE media SET genres = REPLACE(genres, '|Animation|', '|动画|') WHERE genres LIKE '%|Animation|%';
UPDATE media SET genres = REPLACE(genres, '|Biography|', '|传记|') WHERE genres LIKE '%|Biography|%';

-- AniList (anime / manga).
UPDATE media SET genres = REPLACE(genres, '|Slice of Life|', '|日常|') WHERE genres LIKE '%|Slice of Life|%';
UPDATE media SET genres = REPLACE(genres, '|Sports|', '|运动|') WHERE genres LIKE '%|Sports|%';
UPDATE media SET genres = REPLACE(genres, '|Sport|', '|运动|') WHERE genres LIKE '%|Sport|%';
UPDATE media SET genres = REPLACE(genres, '|Supernatural|', '|超自然|') WHERE genres LIKE '%|Supernatural|%';
UPDATE media SET genres = REPLACE(genres, '|Psychological|', '|心理|') WHERE genres LIKE '%|Psychological|%';
UPDATE media SET genres = REPLACE(genres, '|Mecha|', '|机甲|') WHERE genres LIKE '%|Mecha|%';
UPDATE media SET genres = REPLACE(genres, '|Mahou Shoujo|', '|魔法少女|') WHERE genres LIKE '%|Mahou Shoujo|%';

-- IGDB genres (games).
UPDATE media SET genres = REPLACE(genres, '|RPG|', '|角色扮演|') WHERE genres LIKE '%|RPG|%';
UPDATE media SET genres = REPLACE(genres, '|Shooter|', '|射击|') WHERE genres LIKE '%|Shooter|%';
UPDATE media SET genres = REPLACE(genres, '|Fighting|', '|格斗|') WHERE genres LIKE '%|Fighting|%';
UPDATE media SET genres = REPLACE(genres, '|Platform|', '|平台跳跃|') WHERE genres LIKE '%|Platform|%';
UPDATE media SET genres = REPLACE(genres, '|Puzzle|', '|解谜|') WHERE genres LIKE '%|Puzzle|%';
UPDATE media SET genres = REPLACE(genres, '|Racing|', '|竞速|') WHERE genres LIKE '%|Racing|%';
UPDATE media SET genres = REPLACE(genres, '|Simulator|', '|模拟|') WHERE genres LIKE '%|Simulator|%';
UPDATE media SET genres = REPLACE(genres, '|Strategy|', '|策略|') WHERE genres LIKE '%|Strategy|%';
UPDATE media SET genres = REPLACE(genres, '|Tactical|', '|战术|') WHERE genres LIKE '%|Tactical|%';
UPDATE media SET genres = REPLACE(genres, '|Arcade|', '|街机|') WHERE genres LIKE '%|Arcade|%';
UPDATE media SET genres = REPLACE(genres, '|Visual Novel|', '|视觉小说|') WHERE genres LIKE '%|Visual Novel|%';
UPDATE media SET genres = REPLACE(genres, '|Indie|', '|独立|') WHERE genres LIKE '%|Indie|%';
UPDATE media SET genres = REPLACE(genres, '|Hack and slash|', '|砍杀|') WHERE genres LIKE '%|Hack and slash|%';
UPDATE media SET genres = REPLACE(genres, '|Point-and-click|', '|点击冒险|') WHERE genres LIKE '%|Point-and-click|%';

-- IGDB themes.
UPDATE media SET genres = REPLACE(genres, '|Survival|', '|生存|') WHERE genres LIKE '%|Survival|%';
UPDATE media SET genres = REPLACE(genres, '|Stealth|', '|潜行|') WHERE genres LIKE '%|Stealth|%';
UPDATE media SET genres = REPLACE(genres, '|Sandbox|', '|沙盒|') WHERE genres LIKE '%|Sandbox|%';
UPDATE media SET genres = REPLACE(genres, '|Open world|', '|开放世界|') WHERE genres LIKE '%|Open world|%';

-- TMDB TV.
UPDATE media SET genres = REPLACE(genres, '|Reality|', '|真人秀|') WHERE genres LIKE '%|Reality|%';
UPDATE media SET genres = REPLACE(genres, '|Talk|', '|脱口秀|') WHERE genres LIKE '%|Talk|%';
UPDATE media SET genres = REPLACE(genres, '|Kids|', '|儿童|') WHERE genres LIKE '%|Kids|%';
UPDATE media SET genres = REPLACE(genres, '|Soap|', '|肥皂剧|') WHERE genres LIKE '%|Soap|%';

-- A row that somehow carried BOTH language variants of one genre would now
-- hold the Chinese token twice; collapse the adjacent-duplicate case (genres
-- are set from a single source at add time, so anything beyond this is not
-- expected — verify with:
--   SELECT id, genres FROM media WHERE genres LIKE '%|动作|%动作|%';
-- and the equivalents, before/after applying to prod).
UPDATE media SET genres = REPLACE(genres, '|动作|动作|', '|动作|') WHERE genres LIKE '%|动作|动作|%';
UPDATE media SET genres = REPLACE(genres, '|冒险|冒险|', '|冒险|') WHERE genres LIKE '%|冒险|冒险|%';
UPDATE media SET genres = REPLACE(genres, '|喜剧|喜剧|', '|喜剧|') WHERE genres LIKE '%|喜剧|喜剧|%';
UPDATE media SET genres = REPLACE(genres, '|剧情|剧情|', '|剧情|') WHERE genres LIKE '%|剧情|剧情|%';
UPDATE media SET genres = REPLACE(genres, '|奇幻|奇幻|', '|奇幻|') WHERE genres LIKE '%|奇幻|奇幻|%';
UPDATE media SET genres = REPLACE(genres, '|恐怖|恐怖|', '|恐怖|') WHERE genres LIKE '%|恐怖|恐怖|%';
UPDATE media SET genres = REPLACE(genres, '|悬疑|悬疑|', '|悬疑|') WHERE genres LIKE '%|悬疑|悬疑|%';
UPDATE media SET genres = REPLACE(genres, '|爱情|爱情|', '|爱情|') WHERE genres LIKE '%|爱情|爱情|%';
UPDATE media SET genres = REPLACE(genres, '|科幻|科幻|', '|科幻|') WHERE genres LIKE '%|科幻|科幻|%';
UPDATE media SET genres = REPLACE(genres, '|惊悚|惊悚|', '|惊悚|') WHERE genres LIKE '%|惊悚|惊悚|%';
UPDATE media SET genres = REPLACE(genres, '|战争|战争|', '|战争|') WHERE genres LIKE '%|战争|战争|%';
UPDATE media SET genres = REPLACE(genres, '|历史|历史|', '|历史|') WHERE genres LIKE '%|历史|历史|%';
UPDATE media SET genres = REPLACE(genres, '|运动|运动|', '|运动|') WHERE genres LIKE '%|运动|运动|%';
UPDATE media SET genres = REPLACE(genres, '|音乐|音乐|', '|音乐|') WHERE genres LIKE '%|音乐|音乐|%';
UPDATE media SET genres = REPLACE(genres, '|策略|策略|', '|策略|') WHERE genres LIKE '%|策略|策略|%';
