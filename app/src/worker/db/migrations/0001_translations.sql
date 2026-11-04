-- Translation cache. One row per (kind, key, locale) tuple.
--
-- Kind enumerates what's being translated:
--   page         : whole markdown body. key = "{repo}@{branch}:{pagePath}".
--   sidebar      : sidebar tree for a repo+branch. key = "{repo}@{branch}".
--                  Content is a JSON array of {text,text-translated} pairs
--                  keyed by an order-preserving structural id.
--   repo-nav     : per-repo nav from vellum.json / VitePress themeConfig.
--                  key = "{repo}@{branch}".
--   frontmatter  : the translated subset of a page's frontmatter
--                  (title, description, hero.*, features[].*). key matches
--                  the page kind so a single fetch can grab both rows.
--   ui           : the static UI dictionary from src/shared/i18n.ts.
--                  key = "ui:v1" (bumped when the dict shape changes).
--   config       : top-level config strings (tagline excluded title/footer,
--                  repo displayName/description, nav text). key = "site:v1".
--
-- source_hash is the SHA-256 (hex) of the canonicalized source text or JSON.
-- On read, the caller compares the hash to the source it has in hand; a
-- mismatch means the source moved on and the cached translation is stale.
-- This lets the row survive across schema changes that don't actually
-- change the visible content.
CREATE TABLE IF NOT EXISTS translations (
  kind          TEXT    NOT NULL,
  key           TEXT    NOT NULL,
  locale        TEXT    NOT NULL,
  source_hash   TEXT    NOT NULL,
  content       TEXT    NOT NULL,
  model         TEXT,
  refreshed_at  INTEGER NOT NULL,
  PRIMARY KEY (kind, key, locale)
);

-- Index for the scheduled refresher: it pulls rows ordered by refreshed_at
-- ascending and stops at a budget. Without this we'd be doing a full table
-- scan every hour once the table gets large.
CREATE INDEX IF NOT EXISTS idx_translations_refreshed
  ON translations (refreshed_at);

-- Index for webhook invalidation: when a repo pushes, we delete rows whose
-- key starts with "{repo}@%". A prefix index speeds that up.
CREATE INDEX IF NOT EXISTS idx_translations_kind_key
  ON translations (kind, key);
