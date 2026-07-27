-- Backs the AI Image Generation Pipeline (a separate Python/FastAPI/Celery service living in
-- image_pipeline/, sharing this same database). Node never queries these tables directly — it
-- only talks to the pipeline's REST API — but they live in the one shared Neon database rather
-- than a second Postgres instance, per that architectural decision. Column/timestamp style
-- (iso_now() TEXT columns, SERIAL ids, JSON-as-TEXT) matches every other table in this file for
-- consistency, even though the Python side reads these through SQLAlchemy rather than pg.

CREATE TABLE IF NOT EXISTS pipeline_providers (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE, -- e.g. 'flux', 'openai', 'ideogram', 'mock'
  is_active INTEGER NOT NULL DEFAULT 1,
  config_json TEXT,
  created_at TEXT NOT NULL DEFAULT iso_now()
);

-- One row per generate-images call. external_ref carries the caller's own id (Content Studio's
-- draft.id, e.g. "draft_1784708859674") so a job can be looked up by the page it belongs to
-- without either side needing to know about the other's primary keys.
CREATE TABLE IF NOT EXISTS pipeline_generation_jobs (
  id SERIAL PRIMARY KEY,
  external_ref TEXT NOT NULL,
  page_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'partial', 'completed', 'failed')),
  source_json TEXT NOT NULL,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT iso_now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_external_ref ON pipeline_generation_jobs(external_ref);

-- One row per image "slot" on a job (hero/body1/body2/body3) — stable across regenerations;
-- pipeline_image_versions underneath is what actually grows each time someone regenerates.
CREATE TABLE IF NOT EXISTS pipeline_images (
  id SERIAL PRIMARY KEY,
  job_id INTEGER NOT NULL REFERENCES pipeline_generation_jobs(id) ON DELETE CASCADE,
  image_role TEXT NOT NULL CHECK (image_role IN ('hero', 'body1', 'body2', 'body3')),
  current_version_id INTEGER, -- FK added below, after pipeline_image_versions exists
  created_at TEXT NOT NULL DEFAULT iso_now(),
  UNIQUE(job_id, image_role)
);

CREATE TABLE IF NOT EXISTS pipeline_prompts (
  id SERIAL PRIMARY KEY,
  structured_prompt_json TEXT NOT NULL,
  assembled_text TEXT NOT NULL,
  negative_prompt_json TEXT NOT NULL,
  edited_by_user INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT iso_now()
);

-- Never updated in place and never deleted once succeeded — a regenerate always inserts a new
-- row and flips is_current on the old one to 0, so "keep previous version" is just "don't delete
-- old rows," not a separate feature to build.
CREATE TABLE IF NOT EXISTS pipeline_image_versions (
  id SERIAL PRIMARY KEY,
  image_id INTEGER NOT NULL REFERENCES pipeline_images(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  spec_json TEXT NOT NULL,
  prompt_id INTEGER REFERENCES pipeline_prompts(id),
  provider_id INTEGER REFERENCES pipeline_providers(id),
  provider_generation_id TEXT,
  storage_url TEXT,
  storage_key TEXT,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER,
  format TEXT,
  generation_time_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  error_message TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT iso_now(),
  UNIQUE(image_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_pipeline_image_versions_image_current ON pipeline_image_versions(image_id, is_current);

ALTER TABLE pipeline_images ADD CONSTRAINT fk_pipeline_images_current_version
  FOREIGN KEY (current_version_id) REFERENCES pipeline_image_versions(id);

CREATE TABLE IF NOT EXISTS pipeline_audit_logs (
  id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES pipeline_generation_jobs(id) ON DELETE CASCADE,
  image_id INTEGER REFERENCES pipeline_images(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  detail_json TEXT,
  created_at TEXT NOT NULL DEFAULT iso_now()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_audit_logs_job_id ON pipeline_audit_logs(job_id);

INSERT INTO pipeline_providers (name, is_active) VALUES
  ('mock', 1), ('flux', 1), ('openai', 0), ('ideogram', 0)
ON CONFLICT (name) DO NOTHING;
