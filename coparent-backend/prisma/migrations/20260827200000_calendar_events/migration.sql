CREATE TYPE "CalendarEventCategory" AS ENUM ('GENERAL', 'SCHOOL', 'MEDICAL', 'ACTIVITY', 'HANDOVER', 'HOLIDAY');
CREATE TYPE "CalendarEventState" AS ENUM ('ACTIVE', 'CANCELLED');

CREATE TABLE "CalendarEvent" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "currentVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarEvent_currentVersionId_key" UNIQUE ("currentVersionId"),
  CONSTRAINT "CalendarEvent_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "CalendarEventVersion" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "category" "CalendarEventCategory" NOT NULL,
  "state" "CalendarEventState" NOT NULL DEFAULT 'ACTIVE',
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "endsAt" TIMESTAMPTZ(3) NOT NULL,
  "timeZone" TEXT NOT NULL,
  "responsibleParentId" TEXT,
  "changedById" TEXT NOT NULL,
  "changeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CalendarEventVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CalendarEventVersion_eventId_revision_key" UNIQUE ("eventId", "revision"),
  CONSTRAINT "CalendarEventVersion_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 160),
  CONSTRAINT "CalendarEventVersion_description_length_check" CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 5000),
  CONSTRAINT "CalendarEventVersion_timezone_length_check" CHECK (char_length("timeZone") BETWEEN 1 AND 100),
  CONSTRAINT "CalendarEventVersion_time_order_check" CHECK ("endsAt" > "startsAt"),
  CONSTRAINT "CalendarEventVersion_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarEventVersion_responsibleParentId_fkey" FOREIGN KEY ("responsibleParentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarEventVersion_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "CalendarEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CalendarEventVersionChild" (
  "versionId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  CONSTRAINT "CalendarEventVersionChild_pkey" PRIMARY KEY ("versionId", "childId"),
  CONSTRAINT "CalendarEventVersionChild_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "CalendarEventVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "CalendarEventVersionChild_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "CalendarEvent_familyId_createdAt_idx" ON "CalendarEvent"("familyId", "createdAt");
CREATE INDEX "CalendarEventVersion_startsAt_endsAt_idx" ON "CalendarEventVersion"("startsAt", "endsAt");
CREATE INDEX "CalendarEventVersion_responsibleParentId_startsAt_idx" ON "CalendarEventVersion"("responsibleParentId", "startsAt");
CREATE INDEX "CalendarEventVersionChild_childId_idx" ON "CalendarEventVersionChild"("childId");

ALTER TABLE "CalendarEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEventVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CalendarEventVersionChild" ENABLE ROW LEVEL SECURITY;

CREATE POLICY calendar_event_select ON "CalendarEvent" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("familyId"));
CREATE POLICY calendar_version_select ON "CalendarEventVersion" FOR SELECT TO coparent_runtime
  USING (EXISTS (
    SELECT 1 FROM "CalendarEvent" event
    WHERE event."id" = "eventId" AND is_coparent_family_member(event."familyId")
  ));
CREATE POLICY calendar_version_child_select ON "CalendarEventVersionChild" FOR SELECT TO coparent_runtime
  USING (EXISTS (
    SELECT 1 FROM "CalendarEventVersion" version
    JOIN "CalendarEvent" event ON event."id" = version."eventId"
    WHERE version."id" = "versionId" AND is_coparent_family_member(event."familyId")
  ));

CREATE FUNCTION protect_calendar_event_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Calendar events are permanent records'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN RAISE EXCEPTION 'Calendar event identity is immutable'; END IF;
  IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId"
    AND nullif(current_setting('app.calendar_transition_event_id', TRUE), '') IS DISTINCT FROM OLD."id"
  THEN RAISE EXCEPTION 'Calendar current version may change only through a transition function'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION prevent_calendar_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Calendar history is immutable'; END;
$$;
CREATE TRIGGER calendar_event_protected BEFORE UPDATE OR DELETE ON "CalendarEvent"
FOR EACH ROW EXECUTE FUNCTION protect_calendar_event_record();
CREATE TRIGGER calendar_version_immutable BEFORE UPDATE OR DELETE ON "CalendarEventVersion"
FOR EACH ROW EXECUTE FUNCTION prevent_calendar_history_mutation();
CREATE TRIGGER calendar_version_child_immutable BEFORE UPDATE OR DELETE ON "CalendarEventVersionChild"
FOR EACH ROW EXECUTE FUNCTION prevent_calendar_history_mutation();

CREATE FUNCTION validate_coparent_calendar_links(
  target_family_id TEXT, target_responsible_parent_id TEXT, target_child_ids TEXT[]
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  SELECT (
    target_responsible_parent_id IS NULL OR EXISTS (
      SELECT 1 FROM public."FamilyMembership" membership
      WHERE membership."familyId" = target_family_id
        AND membership."userId" = target_responsible_parent_id
        AND membership."role" IN ('OWNER'::public."FamilyRole", 'PARENT'::public."FamilyRole")
    )
  ) AND (
    (SELECT count(DISTINCT child_id) FROM unnest(target_child_ids) AS child_id)
      = coalesce(array_length(target_child_ids, 1), 0)
  ) AND NOT EXISTS (
    SELECT 1 FROM unnest(target_child_ids) AS child_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public."Child" child
      WHERE child."id" = child_id AND child."familyId" = target_family_id
    )
  )
$$;

CREATE FUNCTION create_coparent_calendar_event(
  target_event_id TEXT, target_version_id TEXT, target_family_id TEXT,
  target_category TEXT, target_title TEXT, target_description TEXT,
  target_starts_at TIMESTAMPTZ, target_ends_at TIMESTAMPTZ, target_time_zone TEXT,
  target_responsible_parent_id TEXT, target_child_ids TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
DECLARE actor_id TEXT := public.current_coparent_user_id();
BEGIN
  IF actor_id IS NULL OR NOT public.is_coparent_family_member(target_family_id, TRUE)
    OR target_ends_at <= target_starts_at
    OR char_length(btrim(target_title)) NOT BETWEEN 1 AND 160
    OR (target_description IS NOT NULL AND char_length(btrim(target_description)) NOT BETWEEN 1 AND 5000)
    OR char_length(btrim(target_time_zone)) NOT BETWEEN 1 AND 100
    OR NOT public.validate_coparent_calendar_links(target_family_id, target_responsible_parent_id, target_child_ids)
  THEN RETURN NULL; END IF;

  INSERT INTO public."CalendarEvent" ("id", "familyId", "createdById", "createdAt")
  VALUES (target_event_id, target_family_id, actor_id, timezone('UTC', clock_timestamp()));
  INSERT INTO public."CalendarEventVersion" (
    "id", "eventId", "revision", "category", "state", "title", "description",
    "startsAt", "endsAt", "timeZone", "responsibleParentId", "changedById", "createdAt"
  ) VALUES (
    target_version_id, target_event_id, 1, target_category::public."CalendarEventCategory",
    'ACTIVE'::public."CalendarEventState", btrim(target_title), nullif(btrim(target_description), ''),
    target_starts_at, target_ends_at, btrim(target_time_zone), target_responsible_parent_id,
    actor_id, timezone('UTC', clock_timestamp())
  );
  INSERT INTO public."CalendarEventVersionChild" ("versionId", "childId")
  SELECT target_version_id, child_id FROM unnest(target_child_ids) AS child_id;
  PERFORM set_config('app.calendar_transition_event_id', target_event_id, TRUE);
  UPDATE public."CalendarEvent" SET "currentVersionId" = target_version_id WHERE "id" = target_event_id;
  PERFORM set_config('app.calendar_transition_event_id', '', TRUE);
  INSERT INTO public."AuditEvent" ("id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata")
  VALUES (gen_random_uuid()::TEXT, target_family_id, actor_id, 'CALENDAR_EVENT_CREATED', 'CalendarEvent',
    target_event_id, timezone('UTC', clock_timestamp()), jsonb_build_object('category', target_category));
  RETURN target_event_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;

CREATE FUNCTION revise_coparent_calendar_event(
  target_event_id TEXT, target_version_id TEXT, target_family_id TEXT,
  target_category TEXT, target_title TEXT, target_description TEXT,
  target_starts_at TIMESTAMPTZ, target_ends_at TIMESTAMPTZ, target_time_zone TEXT,
  target_responsible_parent_id TEXT, target_change_reason TEXT, target_child_ids TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  event_record public."CalendarEvent"%ROWTYPE;
  next_revision INTEGER;
BEGIN
  SELECT event.* INTO event_record FROM public."CalendarEvent" event
  WHERE event."id" = target_event_id AND event."familyId" = target_family_id FOR UPDATE;
  IF NOT FOUND OR actor_id IS NULL OR NOT public.is_coparent_family_member(target_family_id, TRUE)
    OR target_ends_at <= target_starts_at
    OR char_length(btrim(target_title)) NOT BETWEEN 1 AND 160
    OR char_length(btrim(target_change_reason)) NOT BETWEEN 1 AND 500
    OR (target_description IS NOT NULL AND char_length(btrim(target_description)) NOT BETWEEN 1 AND 5000)
    OR char_length(btrim(target_time_zone)) NOT BETWEEN 1 AND 100
    OR NOT public.validate_coparent_calendar_links(target_family_id, target_responsible_parent_id, target_child_ids)
  THEN RETURN NULL; END IF;
  SELECT max(version."revision") + 1 INTO next_revision FROM public."CalendarEventVersion" version
  WHERE version."eventId" = target_event_id;
  INSERT INTO public."CalendarEventVersion" (
    "id", "eventId", "revision", "category", "state", "title", "description", "startsAt", "endsAt",
    "timeZone", "responsibleParentId", "changedById", "changeReason", "createdAt"
  ) VALUES (
    target_version_id, target_event_id, next_revision, target_category::public."CalendarEventCategory",
    'ACTIVE'::public."CalendarEventState", btrim(target_title), nullif(btrim(target_description), ''),
    target_starts_at, target_ends_at, btrim(target_time_zone), target_responsible_parent_id,
    actor_id, btrim(target_change_reason), timezone('UTC', clock_timestamp())
  );
  INSERT INTO public."CalendarEventVersionChild" ("versionId", "childId")
  SELECT target_version_id, child_id FROM unnest(target_child_ids) AS child_id;
  PERFORM set_config('app.calendar_transition_event_id', target_event_id, TRUE);
  UPDATE public."CalendarEvent" SET "currentVersionId" = target_version_id WHERE "id" = target_event_id;
  PERFORM set_config('app.calendar_transition_event_id', '', TRUE);
  INSERT INTO public."AuditEvent" ("id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata")
  VALUES (gen_random_uuid()::TEXT, target_family_id, actor_id, 'CALENDAR_EVENT_CHANGED', 'CalendarEvent',
    target_event_id, timezone('UTC', clock_timestamp()), jsonb_build_object('revision', next_revision));
  RETURN target_event_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;

CREATE FUNCTION cancel_coparent_calendar_event(
  target_event_id TEXT, target_version_id TEXT, target_family_id TEXT, target_change_reason TEXT
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  event_record public."CalendarEvent"%ROWTYPE;
  current_record public."CalendarEventVersion"%ROWTYPE;
  next_revision INTEGER;
BEGIN
  SELECT event.* INTO event_record FROM public."CalendarEvent" event
  WHERE event."id" = target_event_id AND event."familyId" = target_family_id FOR UPDATE;
  IF NOT FOUND OR actor_id IS NULL OR NOT public.is_coparent_family_member(target_family_id, TRUE)
    OR char_length(btrim(target_change_reason)) NOT BETWEEN 1 AND 500
  THEN RETURN NULL; END IF;
  SELECT version.* INTO current_record FROM public."CalendarEventVersion" version
  WHERE version."id" = event_record."currentVersionId";
  IF current_record."state" = 'CANCELLED'::public."CalendarEventState" THEN RETURN NULL; END IF;
  next_revision := current_record."revision" + 1;
  INSERT INTO public."CalendarEventVersion" (
    "id", "eventId", "revision", "category", "state", "title", "description", "startsAt", "endsAt",
    "timeZone", "responsibleParentId", "changedById", "changeReason", "createdAt"
  ) VALUES (
    target_version_id, target_event_id, next_revision, current_record."category", 'CANCELLED',
    current_record."title", current_record."description", current_record."startsAt", current_record."endsAt",
    current_record."timeZone", current_record."responsibleParentId", actor_id, btrim(target_change_reason),
    timezone('UTC', clock_timestamp())
  );
  INSERT INTO public."CalendarEventVersionChild" ("versionId", "childId")
  SELECT target_version_id, link."childId" FROM public."CalendarEventVersionChild" link
  WHERE link."versionId" = current_record."id";
  PERFORM set_config('app.calendar_transition_event_id', target_event_id, TRUE);
  UPDATE public."CalendarEvent" SET "currentVersionId" = target_version_id WHERE "id" = target_event_id;
  PERFORM set_config('app.calendar_transition_event_id', '', TRUE);
  INSERT INTO public."AuditEvent" ("id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata")
  VALUES (gen_random_uuid()::TEXT, target_family_id, actor_id, 'CALENDAR_EVENT_CANCELLED', 'CalendarEvent',
    target_event_id, timezone('UTC', clock_timestamp()), jsonb_build_object('revision', next_revision));
  RETURN target_event_id;
END;
$$;

REVOKE ALL ON FUNCTION protect_calendar_event_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_calendar_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION validate_coparent_calendar_links(TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_coparent_calendar_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION revise_coparent_calendar_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION cancel_coparent_calendar_event(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_coparent_calendar_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revise_coparent_calendar_event(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION cancel_coparent_calendar_event(TEXT, TEXT, TEXT, TEXT) TO coparent_runtime;
GRANT SELECT ON "CalendarEvent", "CalendarEventVersion", "CalendarEventVersionChild" TO coparent_runtime;
