-- +goose Up
-- llm_routes.is_default 语义已移除：不再有 default route fallback。
UPDATE llm_routes SET is_default = 0 WHERE is_default != 0;
DROP INDEX IF EXISTS ux_llm_routes_credential_default;
ALTER TABLE llm_routes DROP COLUMN is_default;

-- +goose Down
ALTER TABLE llm_routes ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX ux_llm_routes_credential_default ON llm_routes (credential_id) WHERE is_default = 1;
