CREATE TABLE "CalendarSubscription" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  CONSTRAINT "CalendarSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarSubscription_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarSubscription_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarSubscription_label_check" CHECK (char_length(btrim("label")) BETWEEN 1 AND 120),
  CONSTRAINT "CalendarSubscription_token_hash_check" CHECK ("tokenHash" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "CalendarSubscription_tokenHash_key" ON "CalendarSubscription"("tokenHash");
CREATE INDEX "CalendarSubscription_familyId_revokedAt_createdAt_idx" ON "CalendarSubscription"("familyId", "revokedAt", "createdAt");
CREATE INDEX "CalendarSubscription_createdById_revokedAt_idx" ON "CalendarSubscription"("createdById", "revokedAt");

ALTER TABLE "CalendarSubscription" ENABLE ROW LEVEL SECURITY;
CREATE POLICY calendar_subscription_select ON "CalendarSubscription" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("familyId"));
CREATE POLICY calendar_subscription_insert ON "CalendarSubscription" FOR INSERT TO coparent_runtime
  WITH CHECK (
    "createdById" = current_coparent_user_id()
    AND is_coparent_family_member("familyId", TRUE)
  );

CREATE FUNCTION protect_calendar_subscription() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Calendar subscriptions cannot be deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."label" IS DISTINCT FROM OLD."label"
    OR NEW."tokenHash" IS DISTINCT FROM OLD."tokenHash"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
    OR (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt")
  THEN
    RAISE EXCEPTION 'Calendar subscription identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER calendar_subscription_protected
BEFORE UPDATE OR DELETE ON "CalendarSubscription"
FOR EACH ROW EXECUTE FUNCTION protect_calendar_subscription();

CREATE FUNCTION revoke_coparent_calendar_subscription(
  target_subscription_id TEXT,
  target_family_id TEXT
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
  actor TEXT := public.current_coparent_user_id();
  revoked_id TEXT;
BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_member(target_family_id, TRUE) THEN
    RETURN NULL;
  END IF;

  UPDATE public."CalendarSubscription" subscription
  SET "revokedAt" = timezone('UTC', clock_timestamp())
  WHERE subscription."id" = target_subscription_id
    AND subscription."familyId" = target_family_id
    AND subscription."revokedAt" IS NULL
    AND (
      subscription."createdById" = actor
      OR public.is_coparent_family_owner(target_family_id)
    )
  RETURNING subscription."id" INTO revoked_id;

  IF revoked_id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public."AuditEvent" (
    "id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt"
  ) VALUES (
    gen_random_uuid()::TEXT, target_family_id, actor,
    'CALENDAR_SUBSCRIPTION_REVOKED', 'CalendarSubscription', revoked_id,
    timezone('UTC', clock_timestamp())
  );
  RETURN revoked_id;
END;
$$;

CREATE FUNCTION resolve_coparent_calendar_subscription(target_token_hash TEXT)
RETURNS TABLE ("familyId" TEXT, "familyName" TEXT, "createdById" TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC' AS $$
DECLARE
  matched_family_id TEXT;
  matched_family_name TEXT;
  matched_creator_id TEXT;
BEGIN
  SELECT subscription."familyId", family."name", subscription."createdById"
  INTO matched_family_id, matched_family_name, matched_creator_id
  FROM public."CalendarSubscription" subscription
  JOIN public."Family" family ON family."id" = subscription."familyId"
  WHERE subscription."tokenHash" = target_token_hash
    AND subscription."revokedAt" IS NULL
    AND EXISTS (
      SELECT 1 FROM public."FamilyMembership" membership
      WHERE membership."familyId" = subscription."familyId"
        AND membership."userId" = subscription."createdById"
        AND membership."role" IN ('OWNER'::public."FamilyRole", 'PARENT'::public."FamilyRole")
    );

  IF matched_family_id IS NULL THEN RETURN; END IF;

  UPDATE public."CalendarSubscription"
  SET "lastAccessedAt" = timezone('UTC', clock_timestamp())
  WHERE "tokenHash" = target_token_hash;

  PERFORM set_config('app.current_user_id', matched_creator_id, TRUE);
  RETURN QUERY SELECT matched_family_id, matched_family_name, matched_creator_id;
END;
$$;

REVOKE ALL ON TABLE "CalendarSubscription" FROM PUBLIC;
REVOKE ALL ON FUNCTION protect_calendar_subscription() FROM PUBLIC;
REVOKE ALL ON FUNCTION revoke_coparent_calendar_subscription(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_coparent_calendar_subscription(TEXT) FROM PUBLIC;
GRANT SELECT, INSERT ON "CalendarSubscription" TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revoke_coparent_calendar_subscription(TEXT, TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION resolve_coparent_calendar_subscription(TEXT) TO coparent_runtime;
