-- 001_app_tables.sql
-- OmniMetrics Portal: application tables (users, project access, audit log).
--
-- Run ONCE against the PORTAL's own database (portal_db, default omnimetrics_portal) as its owner
-- (owner_role, default portal_owner):
--   psql -U portal_owner -d omnimetrics_portal -h localhost -f db/migrations/001_app_tables.sql
--
-- Creates app_* tables only. jaysnet_data is an external data source and is not touched.

BEGIN;

CREATE TABLE app_users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(100) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    role            VARCHAR(50) NOT NULL DEFAULT 'viewer',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'builder', 'viewer'))
);

-- Project (folder_name) access for builder and viewer users.
-- Admins are not filtered by project (allowed_projects = null in the JWT).
-- A builder/viewer with no rows here sees nothing.
CREATE TABLE app_user_projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    folder_name TEXT NOT NULL,
    UNIQUE(user_id, folder_name)
);

CREATE TABLE app_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID REFERENCES app_users(id),
    action      TEXT,
    detail      JSONB,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_app_user_projects_user_id ON app_user_projects(user_id);

COMMIT;
