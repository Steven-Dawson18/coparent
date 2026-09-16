-- Local development only. Production credentials must come from a secret manager.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'coparent_app') THEN
    CREATE ROLE coparent_app LOGIN PASSWORD 'local-runtime-password';
  END IF;
END
$$;

GRANT coparent_runtime TO coparent_app;
