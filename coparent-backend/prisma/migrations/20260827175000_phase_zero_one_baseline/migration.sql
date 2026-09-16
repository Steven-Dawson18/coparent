-- Baseline section 1: 20260826170000_phase_zero_foundation
CREATE TYPE "FamilyRole" AS ENUM ('OWNER', 'PARENT', 'PROFESSIONAL_READ_ONLY');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Family" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Family_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIdentity" (
    "id" TEXT NOT NULL,
    "providerIssuer" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FamilyMembership" (
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FamilyMembership_pkey" PRIMARY KEY ("familyId", "userId")
);

CREATE TABLE "Child" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "dateOfBirth" TIMESTAMP(3) NOT NULL,
    "school" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Child_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
    "sequence" BIGSERIAL NOT NULL,
    "id" TEXT NOT NULL,
    "familyId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("sequence")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "ExternalIdentity_providerIssuer_subject_key" ON "ExternalIdentity"("providerIssuer", "subject");
CREATE INDEX "ExternalIdentity_userId_idx" ON "ExternalIdentity"("userId");
CREATE INDEX "FamilyMembership_userId_idx" ON "FamilyMembership"("userId");
CREATE INDEX "Child_familyId_idx" ON "Child"("familyId");
CREATE UNIQUE INDEX "AuditEvent_id_key" ON "AuditEvent"("id");
CREATE INDEX "AuditEvent_familyId_sequence_idx" ON "AuditEvent"("familyId", "sequence");
CREATE INDEX "AuditEvent_actorId_sequence_idx" ON "AuditEvent"("actorId", "sequence");

ALTER TABLE "FamilyMembership" ADD CONSTRAINT "FamilyMembership_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyMembership" ADD CONSTRAINT "FamilyMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Child" ADD CONSTRAINT "Child_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION prevent_audit_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update_or_delete
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_mutation();

-- Runtime access is deliberately separate from schema ownership. Production
-- grants LOGIN only to an environment-specific user which inherits this role.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'coparent_runtime') THEN
    CREATE ROLE coparent_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

CREATE FUNCTION current_coparent_user_id() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.current_user_id', true), '')
$$;

CREATE FUNCTION is_coparent_family_member(target_family_id TEXT, require_write BOOLEAN DEFAULT FALSE)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."FamilyMembership" membership
    WHERE membership."familyId" = target_family_id
      AND membership."userId" = public.current_coparent_user_id()
      AND (
        NOT require_write
        OR membership."role" IN ('OWNER'::public."FamilyRole", 'PARENT'::public."FamilyRole")
      )
  )
$$;

CREATE FUNCTION is_coparent_family_owner(target_family_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public."FamilyMembership" membership
    WHERE membership."familyId" = target_family_id
      AND membership."userId" = public.current_coparent_user_id()
      AND membership."role" = 'OWNER'::public."FamilyRole"
  )
$$;

CREATE FUNCTION can_view_coparent_user(target_user_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT target_user_id = public.current_coparent_user_id()
    OR EXISTS (
      SELECT 1
      FROM public."FamilyMembership" mine
      JOIN public."FamilyMembership" theirs ON theirs."familyId" = mine."familyId"
      WHERE mine."userId" = public.current_coparent_user_id()
        AND theirs."userId" = target_user_id
    )
$$;

CREATE FUNCTION find_coparent_local_auth_user(target_email TEXT)
RETURNS SETOF public."User"
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT * FROM public."User" WHERE "email" = lower(trim(target_email)) LIMIT 1
$$;

CREATE FUNCTION resolve_coparent_external_identity(target_issuer TEXT, target_subject TEXT)
RETURNS TABLE ("userId" TEXT, "email" TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT identity."userId", account."email"
  FROM public."ExternalIdentity" identity
  JOIN public."User" account ON account."id" = identity."userId"
  WHERE identity."providerIssuer" = target_issuer
    AND identity."subject" = target_subject
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION is_coparent_family_member(TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION is_coparent_family_owner(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION can_view_coparent_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION find_coparent_local_auth_user(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_coparent_external_identity(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_coparent_family_member(TEXT, BOOLEAN) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION is_coparent_family_owner(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION can_view_coparent_user(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION find_coparent_local_auth_user(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION resolve_coparent_external_identity(TEXT, TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION current_coparent_user_id() TO coparent_runtime;

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_select ON "User" FOR SELECT TO coparent_runtime
  USING (can_view_coparent_user("id"));
CREATE POLICY user_insert ON "User" FOR INSERT TO coparent_runtime
  WITH CHECK (current_coparent_user_id() IS NULL);
CREATE POLICY user_update ON "User" FOR UPDATE TO coparent_runtime
  USING ("id" = current_coparent_user_id())
  WITH CHECK ("id" = current_coparent_user_id());

ALTER TABLE "Family" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Family" FORCE ROW LEVEL SECURITY;
CREATE POLICY family_select ON "Family" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("id"));
CREATE POLICY family_insert ON "Family" FOR INSERT TO coparent_runtime
  WITH CHECK (current_coparent_user_id() IS NOT NULL);
CREATE POLICY family_update ON "Family" FOR UPDATE TO coparent_runtime
  USING (is_coparent_family_member("id", TRUE))
  WITH CHECK (is_coparent_family_member("id", TRUE));

ALTER TABLE "FamilyMembership" ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_select ON "FamilyMembership" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("familyId"));
CREATE POLICY membership_insert ON "FamilyMembership" FOR INSERT TO coparent_runtime
  WITH CHECK (
    ("userId" = current_coparent_user_id() AND "role" = 'OWNER'::"FamilyRole")
    OR is_coparent_family_owner("familyId")
  );
CREATE POLICY membership_update ON "FamilyMembership" FOR UPDATE TO coparent_runtime
  USING (is_coparent_family_owner("familyId"))
  WITH CHECK (is_coparent_family_owner("familyId"));

ALTER TABLE "Child" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Child" FORCE ROW LEVEL SECURITY;
CREATE POLICY child_select ON "Child" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("familyId"));
CREATE POLICY child_insert ON "Child" FOR INSERT TO coparent_runtime
  WITH CHECK (is_coparent_family_member("familyId", TRUE));
CREATE POLICY child_update ON "Child" FOR UPDATE TO coparent_runtime
  USING (is_coparent_family_member("familyId", TRUE))
  WITH CHECK (is_coparent_family_member("familyId", TRUE));

ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_select ON "AuditEvent" FOR SELECT TO coparent_runtime
  USING (
    ("familyId" IS NULL AND "actorId" = current_coparent_user_id())
    OR is_coparent_family_member("familyId")
  );
CREATE POLICY audit_insert ON "AuditEvent" FOR INSERT TO coparent_runtime
  WITH CHECK (
    "actorId" = current_coparent_user_id()
    AND ("familyId" IS NULL OR is_coparent_family_member("familyId"))
  );

GRANT USAGE ON SCHEMA public TO coparent_runtime;
GRANT SELECT, INSERT, UPDATE ON "User", "Family", "FamilyMembership", "Child" TO coparent_runtime;
GRANT SELECT, INSERT ON "AuditEvent" TO coparent_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO coparent_runtime;
-- Baseline section 2: 20260827110000_phase_one_invitations
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'REVOKED', 'EXPIRED');

CREATE TABLE "FamilyInvitation" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "FamilyRole" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "invitedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "FamilyInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FamilyInvitation_tokenHash_key" ON "FamilyInvitation"("tokenHash");
CREATE INDEX "FamilyInvitation_familyId_status_idx" ON "FamilyInvitation"("familyId", "status");
CREATE INDEX "FamilyInvitation_email_status_idx" ON "FamilyInvitation"("email", "status");
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_familyId_fkey"
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_invitedById_fkey"
  FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FamilyInvitation" ADD CONSTRAINT "FamilyInvitation_resolvedById_fkey"
  FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FamilyInvitation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY invitation_select ON "FamilyInvitation" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_owner("familyId"));
CREATE POLICY invitation_insert ON "FamilyInvitation" FOR INSERT TO coparent_runtime
  WITH CHECK (
    is_coparent_family_owner("familyId")
    AND "invitedById" = current_coparent_user_id()
    AND "role" IN ('PARENT'::"FamilyRole", 'PROFESSIONAL_READ_ONLY'::"FamilyRole")
    AND "status" = 'PENDING'::"InvitationStatus"
  );
CREATE FUNCTION accept_coparent_family_invitation(target_token_hash TEXT)
RETURNS TABLE ("invitationId" TEXT, "familyId" TEXT, "role" "FamilyRole")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  actor_email TEXT;
  invitation public."FamilyInvitation"%ROWTYPE;
BEGIN
  SELECT lower(account."email") INTO actor_email
  FROM public."User" account WHERE account."id" = actor_id;

  SELECT * INTO invitation FROM public."FamilyInvitation"
  WHERE "tokenHash" = target_token_hash FOR UPDATE;

  IF actor_email IS NULL OR invitation."id" IS NULL
     OR invitation."status" <> 'PENDING'::public."InvitationStatus"
     OR invitation."expiresAt" <= clock_timestamp()
     OR lower(invitation."email") <> actor_email
     OR EXISTS (
       SELECT 1 FROM public."FamilyMembership" membership
       WHERE membership."familyId" = invitation."familyId" AND membership."userId" = actor_id
     ) THEN
    RETURN;
  END IF;

  UPDATE public."FamilyInvitation" SET
    "status" = 'ACCEPTED'::public."InvitationStatus",
    "resolvedById" = actor_id,
    "resolvedAt" = clock_timestamp()
  WHERE "id" = invitation."id";

  INSERT INTO public."FamilyMembership" ("familyId", "userId", "role", "joinedAt")
  VALUES (invitation."familyId", actor_id, invitation."role", clock_timestamp());

  INSERT INTO public."AuditEvent" ("id", "familyId", "actorId", "action", "entityType", "entityId", "metadata")
  VALUES (gen_random_uuid()::text, invitation."familyId", actor_id, 'FAMILY_INVITATION_ACCEPTED',
          'FamilyInvitation', invitation."id", jsonb_build_object('role', invitation."role"));

  RETURN QUERY SELECT invitation."id", invitation."familyId", invitation."role";
END;
$$;

CREATE FUNCTION revoke_coparent_family_invitation(target_invitation_id TEXT, target_family_id TEXT)
RETURNS TABLE ("invitationId" TEXT, "familyId" TEXT, "status" "InvitationStatus")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  invitation public."FamilyInvitation"%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT public.is_coparent_family_owner(target_family_id) THEN
    RETURN;
  END IF;

  SELECT * INTO invitation FROM public."FamilyInvitation"
  WHERE "id" = target_invitation_id
    AND "familyId" = target_family_id
    AND "status" = 'PENDING'::public."InvitationStatus"
    AND "expiresAt" > clock_timestamp()
  FOR UPDATE;

  IF invitation."id" IS NULL THEN
    RETURN;
  END IF;

  UPDATE public."FamilyInvitation" SET
    "status" = 'REVOKED'::public."InvitationStatus",
    "resolvedById" = actor_id,
    "resolvedAt" = clock_timestamp()
  WHERE "id" = invitation."id";

  INSERT INTO public."AuditEvent" ("id", "familyId", "actorId", "action", "entityType", "entityId")
  VALUES (gen_random_uuid()::text, invitation."familyId", actor_id,
          'FAMILY_INVITATION_REVOKED', 'FamilyInvitation', invitation."id");

  RETURN QUERY SELECT invitation."id", invitation."familyId", 'REVOKED'::public."InvitationStatus";
END;
$$;

CREATE FUNCTION decline_coparent_family_invitation(target_token_hash TEXT)
RETURNS TABLE ("invitationId" TEXT, "status" "InvitationStatus")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  actor_email TEXT;
  invitation public."FamilyInvitation"%ROWTYPE;
BEGIN
  SELECT lower(account."email") INTO actor_email
  FROM public."User" account WHERE account."id" = actor_id;

  SELECT * INTO invitation FROM public."FamilyInvitation"
  WHERE "tokenHash" = target_token_hash FOR UPDATE;

  IF actor_email IS NULL OR invitation."id" IS NULL
     OR invitation."status" <> 'PENDING'::public."InvitationStatus"
     OR invitation."expiresAt" <= clock_timestamp()
     OR lower(invitation."email") <> actor_email THEN
    RETURN;
  END IF;

  UPDATE public."FamilyInvitation" SET
    "status" = 'DECLINED'::public."InvitationStatus",
    "resolvedById" = actor_id,
    "resolvedAt" = clock_timestamp()
  WHERE "id" = invitation."id";

  INSERT INTO public."AuditEvent" ("id", "actorId", "action", "entityType", "entityId")
  VALUES (gen_random_uuid()::text, actor_id, 'FAMILY_INVITATION_DECLINED', 'FamilyInvitation', invitation."id");

  RETURN QUERY SELECT invitation."id", 'DECLINED'::public."InvitationStatus";
END;
$$;

REVOKE ALL ON FUNCTION accept_coparent_family_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION decline_coparent_family_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_coparent_family_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_coparent_family_invitation(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION decline_coparent_family_invitation(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revoke_coparent_family_invitation(TEXT, TEXT) TO coparent_runtime;
GRANT SELECT, INSERT ON "FamilyInvitation" TO coparent_runtime;
-- Baseline section 3: 20260827123000_fix_invitation_resolution
CREATE OR REPLACE FUNCTION accept_coparent_family_invitation(target_token_hash TEXT)
RETURNS TABLE ("invitationId" TEXT, "familyId" TEXT, "role" "FamilyRole")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id TEXT;
  target_invitation public."FamilyInvitation"%ROWTYPE;
BEGIN
  actor_id := public.current_coparent_user_id();
  IF actor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT invitation.* INTO target_invitation
  FROM public."FamilyInvitation" AS invitation
  JOIN public."User" AS account
    ON account."id" = actor_id
   AND lower(account."email") = lower(invitation."email")
  WHERE invitation."tokenHash" = target_token_hash
    AND invitation."status" = 'PENDING'::public."InvitationStatus"
    AND invitation."expiresAt" > clock_timestamp()
    AND NOT EXISTS (
      SELECT 1 FROM public."FamilyMembership" AS membership
      WHERE membership."familyId" = invitation."familyId"
        AND membership."userId" = actor_id
    )
  FOR UPDATE OF invitation;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public."FamilyInvitation" AS invitation SET
    "status" = 'ACCEPTED'::public."InvitationStatus",
    "resolvedById" = actor_id,
    "resolvedAt" = clock_timestamp()
  WHERE invitation."id" = target_invitation."id";

  INSERT INTO public."FamilyMembership" ("familyId", "userId", "role", "joinedAt")
  VALUES (target_invitation."familyId", actor_id, target_invitation."role", clock_timestamp());

  INSERT INTO public."AuditEvent" ("id", "familyId", "actorId", "action", "entityType", "entityId", "metadata")
  VALUES (gen_random_uuid()::text, target_invitation."familyId", actor_id,
          'FAMILY_INVITATION_ACCEPTED', 'FamilyInvitation', target_invitation."id",
          jsonb_build_object('role', target_invitation."role"));

  RETURN QUERY
    SELECT target_invitation."id", target_invitation."familyId", target_invitation."role";
END;
$$;

CREATE OR REPLACE FUNCTION decline_coparent_family_invitation(target_token_hash TEXT)
RETURNS TABLE ("invitationId" TEXT, "status" "InvitationStatus")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id TEXT;
  target_invitation public."FamilyInvitation"%ROWTYPE;
BEGIN
  actor_id := public.current_coparent_user_id();
  IF actor_id IS NULL THEN
    RETURN;
  END IF;

  SELECT invitation.* INTO target_invitation
  FROM public."FamilyInvitation" AS invitation
  JOIN public."User" AS account
    ON account."id" = actor_id
   AND lower(account."email") = lower(invitation."email")
  WHERE invitation."tokenHash" = target_token_hash
    AND invitation."status" = 'PENDING'::public."InvitationStatus"
    AND invitation."expiresAt" > clock_timestamp()
  FOR UPDATE OF invitation;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public."FamilyInvitation" AS invitation SET
    "status" = 'DECLINED'::public."InvitationStatus",
    "resolvedById" = actor_id,
    "resolvedAt" = clock_timestamp()
  WHERE invitation."id" = target_invitation."id";

  INSERT INTO public."AuditEvent" ("id", "actorId", "action", "entityType", "entityId")
  VALUES (gen_random_uuid()::text, actor_id, 'FAMILY_INVITATION_DECLINED',
          'FamilyInvitation', target_invitation."id");

  RETURN QUERY
    SELECT target_invitation."id", 'DECLINED'::public."InvitationStatus";
END;
$$;

CREATE OR REPLACE FUNCTION revoke_coparent_family_invitation(target_invitation_id TEXT, target_family_id TEXT)
RETURNS TABLE ("invitationId" TEXT, "familyId" TEXT, "status" "InvitationStatus")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  actor_id TEXT;
  target_invitation public."FamilyInvitation"%ROWTYPE;
BEGIN
  actor_id := public.current_coparent_user_id();
  IF actor_id IS NULL OR NOT public.is_coparent_family_owner(target_family_id) THEN
    RETURN;
  END IF;

  SELECT invitation.* INTO target_invitation
  FROM public."FamilyInvitation" AS invitation
  WHERE invitation."id" = target_invitation_id
    AND invitation."familyId" = target_family_id
    AND invitation."status" = 'PENDING'::public."InvitationStatus"
    AND invitation."expiresAt" > clock_timestamp()
  FOR UPDATE OF invitation;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public."FamilyInvitation" AS invitation SET
    "status" = 'REVOKED'::public."InvitationStatus",
    "resolvedById" = actor_id,
    "resolvedAt" = clock_timestamp()
  WHERE invitation."id" = target_invitation."id";

  INSERT INTO public."AuditEvent" ("id", "familyId", "actorId", "action", "entityType", "entityId")
  VALUES (gen_random_uuid()::text, target_invitation."familyId", actor_id,
          'FAMILY_INVITATION_REVOKED', 'FamilyInvitation', target_invitation."id");

  RETURN QUERY
    SELECT target_invitation."id", target_invitation."familyId",
           'REVOKED'::public."InvitationStatus";
END;
$$;

REVOKE ALL ON FUNCTION accept_coparent_family_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION decline_coparent_family_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_coparent_family_invitation(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_coparent_family_invitation(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION decline_coparent_family_invitation(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revoke_coparent_family_invitation(TEXT, TEXT) TO coparent_runtime;
-- Baseline section 4: 20260827130000_bind_invitation_actor
-- PostgreSQL may enter a SECURITY DEFINER function without retaining the
-- transaction-local custom setting on every supported deployment. These narrow
-- wrappers bind the authenticated actor again before entering the locked,
-- email/ownership-verifying resolution functions.

CREATE FUNCTION accept_coparent_family_invitation_for_actor(target_token_hash TEXT, target_actor_id TEXT)
RETURNS TABLE ("invitationId" TEXT, "familyId" TEXT, "role" "FamilyRole")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF target_actor_id IS NULL OR target_actor_id = '' THEN
    RETURN;
  END IF;
  PERFORM set_config('app.current_user_id', target_actor_id, true);
  RETURN QUERY
    SELECT resolved."invitationId", resolved."familyId", resolved."role"
    FROM public.accept_coparent_family_invitation(target_token_hash) AS resolved;
END;
$$;

CREATE FUNCTION decline_coparent_family_invitation_for_actor(target_token_hash TEXT, target_actor_id TEXT)
RETURNS TABLE ("invitationId" TEXT, "status" "InvitationStatus")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF target_actor_id IS NULL OR target_actor_id = '' THEN
    RETURN;
  END IF;
  PERFORM set_config('app.current_user_id', target_actor_id, true);
  RETURN QUERY
    SELECT resolved."invitationId", resolved."status"
    FROM public.decline_coparent_family_invitation(target_token_hash) AS resolved;
END;
$$;

CREATE FUNCTION revoke_coparent_family_invitation_for_actor(
  target_invitation_id TEXT,
  target_family_id TEXT,
  target_actor_id TEXT
)
RETURNS TABLE ("invitationId" TEXT, "familyId" TEXT, "status" "InvitationStatus")
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF target_actor_id IS NULL OR target_actor_id = '' THEN
    RETURN;
  END IF;
  PERFORM set_config('app.current_user_id', target_actor_id, true);
  RETURN QUERY
    SELECT resolved."invitationId", resolved."familyId", resolved."status"
    FROM public.revoke_coparent_family_invitation(target_invitation_id, target_family_id) AS resolved;
END;
$$;

REVOKE EXECUTE ON FUNCTION accept_coparent_family_invitation(TEXT) FROM coparent_runtime;
REVOKE EXECUTE ON FUNCTION decline_coparent_family_invitation(TEXT) FROM coparent_runtime;
REVOKE EXECUTE ON FUNCTION revoke_coparent_family_invitation(TEXT, TEXT) FROM coparent_runtime;
REVOKE ALL ON FUNCTION accept_coparent_family_invitation_for_actor(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION decline_coparent_family_invitation_for_actor(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_coparent_family_invitation_for_actor(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accept_coparent_family_invitation_for_actor(TEXT, TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION decline_coparent_family_invitation_for_actor(TEXT, TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revoke_coparent_family_invitation_for_actor(TEXT, TEXT, TEXT) TO coparent_runtime;
-- Baseline section 5: 20260827133000_use_utc_for_invitation_resolution
-- Prisma DateTime values are persisted as UTC in PostgreSQL timestamp columns.
-- Pin invitation functions to UTC so expiry checks and resolution timestamps do
-- not depend on the database host's local timezone.
ALTER FUNCTION accept_coparent_family_invitation(TEXT) SET timezone TO 'UTC';
ALTER FUNCTION decline_coparent_family_invitation(TEXT) SET timezone TO 'UTC';
ALTER FUNCTION revoke_coparent_family_invitation(TEXT, TEXT) SET timezone TO 'UTC';

GRANT EXECUTE ON FUNCTION accept_coparent_family_invitation(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION decline_coparent_family_invitation(TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revoke_coparent_family_invitation(TEXT, TEXT) TO coparent_runtime;

DROP FUNCTION accept_coparent_family_invitation_for_actor(TEXT, TEXT);
DROP FUNCTION decline_coparent_family_invitation_for_actor(TEXT, TEXT);
DROP FUNCTION revoke_coparent_family_invitation_for_actor(TEXT, TEXT, TEXT);
-- Baseline section 6: 20260827143000_secure_account_registration
-- INSERT ... RETURNING is also checked against the SELECT policy. Bind a new
-- account's generated ID as the transaction actor before insertion, then permit
-- only a self-ID insert. This prevents arbitrary account insertion while making
-- the returned registration record visible in the same statement.
DROP POLICY user_insert ON "User";
CREATE POLICY user_insert ON "User" FOR INSERT TO coparent_runtime
  WITH CHECK (
    current_coparent_user_id() IS NOT NULL
    AND "id" = current_coparent_user_id()
  );
-- Baseline section 7: 20260827150000_secure_family_creation
CREATE FUNCTION current_coparent_creating_family_id() RETURNS TEXT
LANGUAGE sql STABLE PARALLEL SAFE
AS $$
  SELECT NULLIF(current_setting('app.creating_family_id', true), '')
$$;

REVOKE ALL ON FUNCTION current_coparent_creating_family_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_coparent_creating_family_id() TO coparent_runtime;

DROP POLICY family_select ON "Family";
CREATE POLICY family_select ON "Family" FOR SELECT TO coparent_runtime
  USING (
    is_coparent_family_member("id")
    OR (
      current_coparent_user_id() IS NOT NULL
      AND "id" = current_coparent_creating_family_id()
    )
  );

DROP POLICY family_insert ON "Family";
CREATE POLICY family_insert ON "Family" FOR INSERT TO coparent_runtime
  WITH CHECK (
    current_coparent_user_id() IS NOT NULL
    AND current_coparent_creating_family_id() IS NOT NULL
    AND "id" = current_coparent_creating_family_id()
  );
-- Baseline section 8: 20260827153000_secure_initial_owner_membership
-- The initial owner membership is returned before the membership row is visible
-- to the normal family-member SELECT predicate. Expose only the transaction-
-- bound self/OWNER row while its family is being created.
DROP POLICY membership_select ON "FamilyMembership";
CREATE POLICY membership_select ON "FamilyMembership" FOR SELECT TO coparent_runtime
  USING (
    is_coparent_family_member("familyId")
    OR (
      current_coparent_creating_family_id() IS NOT NULL
      AND "familyId" = current_coparent_creating_family_id()
      AND "userId" = current_coparent_user_id()
      AND "role" = 'OWNER'::"FamilyRole"
    )
  );
-- Baseline section 9: 20260827170000_invitation_email_outbox
CREATE TYPE "EmailDeliveryStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'SENT', 'DELIVERED', 'RETRY', 'BOUNCED', 'DEAD'
);

CREATE TABLE "EmailOutbox" (
  "id" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "status" "EmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "ciphertext" TEXT NOT NULL,
  "initializationVector" TEXT NOT NULL,
  "authenticationTag" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastErrorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailOutbox_invitationId_key" ON "EmailOutbox"("invitationId");
CREATE UNIQUE INDEX "EmailOutbox_providerMessageId_key" ON "EmailOutbox"("providerMessageId");
CREATE INDEX "EmailOutbox_status_nextAttemptAt_idx" ON "EmailOutbox"("status", "nextAttemptAt");
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_invitationId_fkey"
  FOREIGN KEY ("invitationId") REFERENCES "FamilyInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EmailOutbox" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION enqueue_coparent_invitation_email(
  target_job_id TEXT,
  target_invitation_id TEXT,
  target_ciphertext TEXT,
  target_initialization_vector TEXT,
  target_authentication_tag TEXT,
  target_key_version INTEGER
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  invitation public."FamilyInvitation"%ROWTYPE;
BEGIN
  SELECT candidate.* INTO invitation
  FROM public."FamilyInvitation" AS candidate
  WHERE candidate."id" = target_invitation_id
    AND candidate."status" = 'PENDING'::public."InvitationStatus"
    AND candidate."invitedById" = public.current_coparent_user_id()
    AND public.is_coparent_family_owner(candidate."familyId");
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public."EmailOutbox" (
    "id", "invitationId", "ciphertext", "initializationVector",
    "authenticationTag", "keyVersion", "updatedAt"
  ) VALUES (
    target_job_id, target_invitation_id, target_ciphertext,
    target_initialization_vector, target_authentication_tag,
    target_key_version, timezone('UTC', clock_timestamp())
  );
  RETURN target_job_id;
END;
$$;

CREATE FUNCTION claim_coparent_email_outbox(target_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  "jobId" TEXT, "invitationId" TEXT, "recipient" TEXT, "role" public."FamilyRole",
  "invitationStatus" public."InvitationStatus", "expiresAt" TIMESTAMP(3),
  "ciphertext" TEXT, "initializationVector" TEXT, "authenticationTag" TEXT,
  "keyVersion" INTEGER, "attempts" INTEGER
)
LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $$
  WITH candidates AS (
    SELECT job."id"
    FROM public."EmailOutbox" AS job
    WHERE (
      job."status" IN ('PENDING'::public."EmailDeliveryStatus", 'RETRY'::public."EmailDeliveryStatus")
      AND job."nextAttemptAt" <= clock_timestamp()
    ) OR (
      job."status" = 'PROCESSING'::public."EmailDeliveryStatus"
      AND job."lockedAt" < clock_timestamp() - interval '5 minutes'
    )
    ORDER BY job."createdAt"
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(target_limit, 1), 25)
  ), claimed AS (
    UPDATE public."EmailOutbox" AS job SET
      "status" = 'PROCESSING'::public."EmailDeliveryStatus",
      "lockedAt" = clock_timestamp(),
      "attempts" = job."attempts" + 1,
      "updatedAt" = clock_timestamp()
    FROM candidates
    WHERE job."id" = candidates."id"
    RETURNING job.*
  )
  SELECT claimed."id", invitation."id", invitation."email", invitation."role",
         invitation."status", invitation."expiresAt", claimed."ciphertext",
         claimed."initializationVector", claimed."authenticationTag",
         claimed."keyVersion", claimed."attempts"
  FROM claimed
  JOIN public."FamilyInvitation" AS invitation ON invitation."id" = claimed."invitationId"
$$;

CREATE FUNCTION complete_coparent_email_outbox(target_job_id TEXT, target_provider_message_id TEXT)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
  UPDATE public."EmailOutbox" SET
    "status" = 'SENT'::public."EmailDeliveryStatus", "sentAt" = clock_timestamp(),
    "lockedAt" = NULL, "providerMessageId" = target_provider_message_id,
    "lastErrorCode" = NULL, "ciphertext" = '', "initializationVector" = '',
    "authenticationTag" = '', "updatedAt" = clock_timestamp()
  WHERE "id" = target_job_id AND "status" = 'PROCESSING'::public."EmailDeliveryStatus"
$$;

CREATE FUNCTION retry_coparent_email_outbox(
  target_job_id TEXT, target_error_code TEXT, target_next_attempt_at TIMESTAMP(3), target_terminal BOOLEAN
) RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
  UPDATE public."EmailOutbox" SET
    "status" = CASE WHEN target_terminal THEN 'DEAD'::public."EmailDeliveryStatus" ELSE 'RETRY'::public."EmailDeliveryStatus" END,
    "nextAttemptAt" = target_next_attempt_at, "lockedAt" = NULL,
    "ciphertext" = CASE WHEN target_terminal THEN '' ELSE "ciphertext" END,
    "initializationVector" = CASE WHEN target_terminal THEN '' ELSE "initializationVector" END,
    "authenticationTag" = CASE WHEN target_terminal THEN '' ELSE "authenticationTag" END,
    "lastErrorCode" = left(target_error_code, 100), "updatedAt" = clock_timestamp()
  WHERE "id" = target_job_id AND "status" = 'PROCESSING'::public."EmailDeliveryStatus"
$$;

CREATE FUNCTION record_coparent_email_event(target_provider_message_id TEXT, target_event TEXT)
RETURNS VOID LANGUAGE sql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
  UPDATE public."EmailOutbox" SET
    "status" = CASE
      WHEN target_event = 'email.delivered' THEN 'DELIVERED'::public."EmailDeliveryStatus"
      WHEN target_event IN ('email.bounced', 'email.complained', 'email.failed', 'email.suppressed') THEN 'BOUNCED'::public."EmailDeliveryStatus"
      ELSE "status"
    END,
    "deliveredAt" = CASE WHEN target_event = 'email.delivered' THEN clock_timestamp() ELSE "deliveredAt" END,
    "lastErrorCode" = CASE
      WHEN target_event IN ('email.bounced', 'email.complained', 'email.failed', 'email.suppressed') THEN target_event
      ELSE "lastErrorCode"
    END,
    "updatedAt" = clock_timestamp()
  WHERE "providerMessageId" = target_provider_message_id
$$;

REVOKE ALL ON FUNCTION enqueue_coparent_invitation_email(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_coparent_email_outbox(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_coparent_email_outbox(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION retry_coparent_email_outbox(TEXT, TEXT, TIMESTAMP WITHOUT TIME ZONE, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_coparent_email_event(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION enqueue_coparent_invitation_email(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION claim_coparent_email_outbox(INTEGER) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION complete_coparent_email_outbox(TEXT, TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION retry_coparent_email_outbox(TEXT, TEXT, TIMESTAMP WITHOUT TIME ZONE, BOOLEAN) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION record_coparent_email_event(TEXT, TEXT) TO coparent_runtime;
-- Baseline section 10: 20260827173000_use_utc_for_email_enqueue
-- EmailOutbox timestamps are stored without a timezone. Pin the enqueue
-- function to UTC so column defaults and claim comparisons use one clock.
ALTER FUNCTION enqueue_coparent_invitation_email(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER)
  SET timezone = 'UTC';
