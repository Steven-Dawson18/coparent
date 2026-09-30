ALTER TABLE "FamilyMembership"
  ADD COLUMN "accessExpiresAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revocationReason" TEXT,
  ADD CONSTRAINT "FamilyMembership_access_window_check" CHECK (
    "accessExpiresAt" IS NULL OR "accessExpiresAt" > "joinedAt"
  ),
  ADD CONSTRAINT "FamilyMembership_revocation_reason_check" CHECK (
    "revocationReason" IS NULL OR char_length(btrim("revocationReason")) BETWEEN 1 AND 500
  ),
  ADD CONSTRAINT "FamilyMembership_revocation_pair_check" CHECK (
    ("revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revocationReason" IS NOT NULL)
  );

CREATE INDEX "FamilyMembership_familyId_role_revokedAt_accessExpiresAt_idx"
  ON "FamilyMembership"("familyId", "role", "revokedAt", "accessExpiresAt");

CREATE OR REPLACE FUNCTION is_coparent_family_member(
  target_family_id TEXT,
  require_write BOOLEAN DEFAULT FALSE
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."FamilyMembership" membership
    WHERE membership."familyId" = target_family_id
      AND membership."userId" = public.current_coparent_user_id()
      AND membership."revokedAt" IS NULL
      AND (
        membership."accessExpiresAt" IS NULL
        OR membership."accessExpiresAt" > timezone('UTC', statement_timestamp())
      )
      AND (
        NOT require_write
        OR membership."role" IN (
          'OWNER'::public."FamilyRole",
          'PARENT'::public."FamilyRole"
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION is_coparent_family_owner(target_family_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."FamilyMembership" membership
    WHERE membership."familyId" = target_family_id
      AND membership."userId" = public.current_coparent_user_id()
      AND membership."role" = 'OWNER'::public."FamilyRole"
      AND membership."revokedAt" IS NULL
      AND (
        membership."accessExpiresAt" IS NULL
        OR membership."accessExpiresAt" > timezone('UTC', statement_timestamp())
      )
  )
$$;

CREATE OR REPLACE FUNCTION can_view_coparent_user(target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog AS $$
  SELECT target_user_id = public.current_coparent_user_id()
    OR EXISTS (
      SELECT 1
      FROM public."FamilyMembership" mine
      JOIN public."FamilyMembership" theirs ON theirs."familyId" = mine."familyId"
      WHERE mine."userId" = public.current_coparent_user_id()
        AND theirs."userId" = target_user_id
        AND mine."revokedAt" IS NULL
        AND (
          mine."accessExpiresAt" IS NULL
          OR mine."accessExpiresAt" > timezone('UTC', statement_timestamp())
        )
    )
$$;

CREATE FUNCTION protect_family_membership_access() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Family membership history cannot be deleted';
  END IF;
  IF NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."joinedAt" IS DISTINCT FROM OLD."joinedAt"
  THEN
    RAISE EXCEPTION 'Family membership identity is immutable';
  END IF;
  IF (
    NEW."accessExpiresAt" IS DISTINCT FROM OLD."accessExpiresAt"
    OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
    OR NEW."revocationReason" IS DISTINCT FROM OLD."revocationReason"
  ) AND nullif(current_setting('app.professional_access_transition_user_id', TRUE), '')
    IS DISTINCT FROM OLD."userId"
  THEN
    RAISE EXCEPTION 'Professional access may change only through a controlled transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER family_membership_access_protected
BEFORE UPDATE OR DELETE ON "FamilyMembership"
FOR EACH ROW EXECUTE FUNCTION protect_family_membership_access();

CREATE FUNCTION configure_coparent_professional_access(
  target_family_id TEXT,
  target_user_id TEXT,
  target_expires_at TIMESTAMPTZ
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
  actor TEXT := public.current_coparent_user_id();
  changed_user_id TEXT;
BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_owner(target_family_id) THEN
    RETURN NULL;
  END IF;
  IF target_expires_at IS NOT NULL
    AND target_expires_at <= statement_timestamp() + interval '5 minutes'
  THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.professional_access_transition_user_id', target_user_id, TRUE);
  UPDATE public."FamilyMembership" membership
  SET "accessExpiresAt" = timezone('UTC', target_expires_at)
  WHERE membership."familyId" = target_family_id
    AND membership."userId" = target_user_id
    AND membership."role" = 'PROFESSIONAL_READ_ONLY'::public."FamilyRole"
    AND membership."revokedAt" IS NULL
  RETURNING membership."userId" INTO changed_user_id;
  PERFORM set_config('app.professional_access_transition_user_id', '', TRUE);

  IF changed_user_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public."AuditEvent" (
    "id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata"
  ) VALUES (
    gen_random_uuid()::TEXT, target_family_id, actor,
    'PROFESSIONAL_ACCESS_EXPIRY_CHANGED', 'FamilyMembership', target_user_id,
    timezone('UTC', clock_timestamp()),
    jsonb_build_object('accessExpiresAt', target_expires_at)
  );
  RETURN changed_user_id;
END;
$$;

CREATE FUNCTION revoke_coparent_professional_access(
  target_family_id TEXT,
  target_user_id TEXT,
  target_reason TEXT
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
  actor TEXT := public.current_coparent_user_id();
  changed_user_id TEXT;
BEGIN
  IF actor IS NULL
    OR NOT public.is_coparent_family_owner(target_family_id)
    OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500
  THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.professional_access_transition_user_id', target_user_id, TRUE);
  UPDATE public."FamilyMembership" membership
  SET "revokedAt" = timezone('UTC', clock_timestamp()),
      "revocationReason" = btrim(target_reason)
  WHERE membership."familyId" = target_family_id
    AND membership."userId" = target_user_id
    AND membership."role" = 'PROFESSIONAL_READ_ONLY'::public."FamilyRole"
    AND membership."revokedAt" IS NULL
  RETURNING membership."userId" INTO changed_user_id;
  PERFORM set_config('app.professional_access_transition_user_id', '', TRUE);

  IF changed_user_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public."AuditEvent" (
    "id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata"
  ) VALUES (
    gen_random_uuid()::TEXT, target_family_id, actor,
    'PROFESSIONAL_ACCESS_REVOKED', 'FamilyMembership', target_user_id,
    timezone('UTC', clock_timestamp()), jsonb_build_object('reason', btrim(target_reason))
  );
  RETURN changed_user_id;
END;
$$;

REVOKE ALL ON FUNCTION protect_family_membership_access() FROM PUBLIC;
REVOKE ALL ON FUNCTION configure_coparent_professional_access(TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_coparent_professional_access(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION configure_coparent_professional_access(TEXT, TEXT, TIMESTAMPTZ) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revoke_coparent_professional_access(TEXT, TEXT, TEXT) TO coparent_runtime;
