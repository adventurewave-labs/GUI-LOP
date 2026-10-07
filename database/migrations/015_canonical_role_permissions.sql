-- 015: canonical role permissions.
--
-- Production bug: with Postgres, role permissions come from the `roles`
-- table, but nothing put the app's permission vocabulary there. A fresh
-- migrate left the table empty, so every non-admin user got 403 on every
-- action (including creating a workflow); the only seed that wrote roles
-- (database/seeds/01_default_data.sql) used a different vocabulary
-- ("read", "write", "execute") which the domain's Permission type rejects,
-- turning every authorisation check for those roles into a 500.
--
-- Upsert the three system roles (the user_role enum) with the same matrix
-- the in-memory adapter uses. Rows an operator has already customised with
-- valid `resource:action` permissions are left alone; empty rows and rows
-- holding the legacy vocabulary are replaced. Admins hold every permission
-- implicitly (authorisation policy), so their list is empty.
INSERT INTO roles (name, description, permissions) VALUES
  ('admin',  'System administrator (implicitly holds every permission)', '[]'::jsonb),
  ('user',   'Regular user: create, read and respond to workflows',     '["workflow:read", "workflow:create", "workflow:respond"]'::jsonb),
  ('viewer', 'Read-only access to workflows',                            '["workflow:read"]'::jsonb)
ON CONFLICT (name) DO UPDATE
  SET permissions = EXCLUDED.permissions,
      description = EXCLUDED.description,
      updated_at  = NOW()
  WHERE roles.permissions = '[]'::jsonb
     OR jsonb_typeof(roles.permissions) <> 'array'
     OR EXISTS (
       SELECT 1 FROM jsonb_array_elements(roles.permissions) AS p
        WHERE jsonb_typeof(p) <> 'string' OR position(':' IN p #>> '{}') = 0
     );
