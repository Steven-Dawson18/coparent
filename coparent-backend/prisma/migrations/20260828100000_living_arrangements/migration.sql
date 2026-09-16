CREATE TYPE "ArrangementFrequency" AS ENUM ('WEEKLY', 'FORTNIGHTLY');
CREATE TYPE "ArrangementState" AS ENUM ('ACTIVE', 'CANCELLED');
CREATE TABLE "LivingArrangement" (
  "id" TEXT PRIMARY KEY, "familyId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "currentVersionId" TEXT UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "LivingArrangementVersion" (
  "id" TEXT PRIMARY KEY, "arrangementId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "state" "ArrangementState" NOT NULL DEFAULT 'ACTIVE', "label" TEXT NOT NULL,
  "frequency" "ArrangementFrequency" NOT NULL, "dayOfWeek" INTEGER NOT NULL,
  "startMinute" INTEGER NOT NULL, "durationMinutes" INTEGER NOT NULL,
  "effectiveStart" DATE NOT NULL, "effectiveEnd" DATE, "timeZone" TEXT NOT NULL,
  "responsibleParentId" TEXT NOT NULL, "changedById" TEXT NOT NULL,
  "changeReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("arrangementId", "revision"),
  CHECK (char_length("label") BETWEEN 1 AND 160), CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  CHECK ("startMinute" BETWEEN 0 AND 1439), CHECK ("durationMinutes" BETWEEN 1 AND 10080),
  CHECK ("effectiveEnd" IS NULL OR "effectiveEnd" >= "effectiveStart"),
  CHECK (char_length("timeZone") BETWEEN 1 AND 100),
  FOREIGN KEY ("arrangementId") REFERENCES "LivingArrangement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("responsibleParentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE "LivingArrangement" ADD FOREIGN KEY ("currentVersionId") REFERENCES "LivingArrangementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "LivingArrangementVersionChild" (
  "versionId" TEXT NOT NULL, "childId" TEXT NOT NULL, PRIMARY KEY ("versionId", "childId"),
  FOREIGN KEY ("versionId") REFERENCES "LivingArrangementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "LivingArrangementException" (
  "id" TEXT PRIMARY KEY, "arrangementId" TEXT NOT NULL, "occurrenceDate" DATE NOT NULL,
  "reason" TEXT NOT NULL, "createdById" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("arrangementId", "occurrenceDate"), CHECK (char_length("reason") BETWEEN 1 AND 500),
  FOREIGN KEY ("arrangementId") REFERENCES "LivingArrangement"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "LivingArrangement_familyId_createdAt_idx" ON "LivingArrangement"("familyId", "createdAt");
CREATE INDEX "LivingArrangementVersion_effectiveStart_effectiveEnd_idx" ON "LivingArrangementVersion"("effectiveStart", "effectiveEnd");
CREATE INDEX "LivingArrangementVersionChild_childId_idx" ON "LivingArrangementVersionChild"("childId");
CREATE INDEX "LivingArrangementException_occurrenceDate_idx" ON "LivingArrangementException"("occurrenceDate");
ALTER TABLE "LivingArrangement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LivingArrangementVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LivingArrangementVersionChild" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LivingArrangementException" ENABLE ROW LEVEL SECURITY;
CREATE POLICY arrangement_select ON "LivingArrangement" FOR SELECT TO coparent_runtime USING (is_coparent_family_member("familyId"));
CREATE POLICY arrangement_version_select ON "LivingArrangementVersion" FOR SELECT TO coparent_runtime USING (EXISTS (SELECT 1 FROM "LivingArrangement" a WHERE a."id"="arrangementId" AND is_coparent_family_member(a."familyId")));
CREATE POLICY arrangement_child_select ON "LivingArrangementVersionChild" FOR SELECT TO coparent_runtime USING (EXISTS (SELECT 1 FROM "LivingArrangementVersion" v JOIN "LivingArrangement" a ON a."id"=v."arrangementId" WHERE v."id"="versionId" AND is_coparent_family_member(a."familyId")));
CREATE POLICY arrangement_exception_select ON "LivingArrangementException" FOR SELECT TO coparent_runtime USING (EXISTS (SELECT 1 FROM "LivingArrangement" a WHERE a."id"="arrangementId" AND is_coparent_family_member(a."familyId")));

CREATE FUNCTION protect_living_arrangement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Living arrangements are permanent records'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."familyId" IS DISTINCT FROM OLD."familyId" OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'Living arrangement identity is immutable'; END IF;
  IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId" AND nullif(current_setting('app.arrangement_transition_id',TRUE),'') IS DISTINCT FROM OLD."id" THEN RAISE EXCEPTION 'Arrangement versions may change only through a transition function'; END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION prevent_arrangement_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Living arrangement history is immutable'; END; $$;
CREATE TRIGGER arrangement_protected BEFORE UPDATE OR DELETE ON "LivingArrangement" FOR EACH ROW EXECUTE FUNCTION protect_living_arrangement();
CREATE TRIGGER arrangement_version_immutable BEFORE UPDATE OR DELETE ON "LivingArrangementVersion" FOR EACH ROW EXECUTE FUNCTION prevent_arrangement_history_mutation();
CREATE TRIGGER arrangement_child_immutable BEFORE UPDATE OR DELETE ON "LivingArrangementVersionChild" FOR EACH ROW EXECUTE FUNCTION prevent_arrangement_history_mutation();
CREATE TRIGGER arrangement_exception_immutable BEFORE UPDATE OR DELETE ON "LivingArrangementException" FOR EACH ROW EXECUTE FUNCTION prevent_arrangement_history_mutation();

CREATE FUNCTION list_coparent_living_occurrences(target_family_id TEXT, target_from TIMESTAMPTZ, target_to TIMESTAMPTZ)
RETURNS TABLE ("arrangementId" TEXT,"versionId" TEXT,"occurrenceDate" DATE,"label" TEXT,"startsAt" TIMESTAMPTZ,"endsAt" TIMESTAMPTZ,"timeZone" TEXT,"responsibleParentId" TEXT,"childIds" TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
  SELECT a."id",v."id",d::DATE,v."label",
    (d::DATE + make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone" AS starts,
    ((d::DATE + make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone") + make_interval(mins=>v."durationMinutes") AS ends,
    v."timeZone",v."responsibleParentId",array_agg(vc."childId" ORDER BY vc."childId")
  FROM public."LivingArrangement" a JOIN public."LivingArrangementVersion" v ON v."id"=a."currentVersionId"
  JOIN public."LivingArrangementVersionChild" vc ON vc."versionId"=v."id"
  CROSS JOIN LATERAL generate_series(GREATEST(v."effectiveStart",(target_from AT TIME ZONE v."timeZone")::DATE),LEAST(coalesce(v."effectiveEnd",(target_to AT TIME ZONE v."timeZone")::DATE),(target_to AT TIME ZONE v."timeZone")::DATE),interval '1 day') d
  WHERE a."familyId"=target_family_id AND public.is_coparent_family_member(a."familyId") AND v."state"='ACTIVE'
    AND extract(isodow FROM d)=v."dayOfWeek"
    AND (v."frequency"='WEEKLY' OR mod(((d::DATE-v."effectiveStart")/7),2)=0)
    AND NOT EXISTS (SELECT 1 FROM public."LivingArrangementException" e WHERE e."arrangementId"=a."id" AND e."occurrenceDate"=d::DATE)
    AND ((d::DATE+make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone") < target_to
    AND (((d::DATE+make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone")+make_interval(mins=>v."durationMinutes")) > target_from
  GROUP BY a."id",v."id",d
$$;

CREATE FUNCTION create_coparent_living_arrangement(target_id TEXT,target_version_id TEXT,target_family_id TEXT,target_label TEXT,target_frequency TEXT,target_day INTEGER,target_start_minute INTEGER,target_duration INTEGER,target_effective_start DATE,target_effective_end DATE,target_timezone TEXT,target_parent_id TEXT,target_child_ids TEXT[]) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id(); conflict_exists BOOLEAN;
BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_member(target_family_id,TRUE) OR target_day NOT BETWEEN 1 AND 7 OR target_start_minute NOT BETWEEN 0 AND 1439 OR target_duration NOT BETWEEN 1 AND 10080 OR target_effective_end IS NOT NULL AND target_effective_end<target_effective_start OR char_length(btrim(target_label)) NOT BETWEEN 1 AND 160 OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" m WHERE m."familyId"=target_family_id AND m."userId"=target_parent_id AND m."role" IN('OWNER','PARENT')) OR coalesce(array_length(target_child_ids,1),0)=0 OR EXISTS(SELECT 1 FROM unnest(target_child_ids)c WHERE NOT EXISTS(SELECT 1 FROM public."Child" ch WHERE ch."id"=c AND ch."familyId"=target_family_id)) THEN RETURN NULL; END IF;
  WITH candidate AS (
    SELECT d::DATE AS occurrence_day,
      (d::DATE+make_interval(mins=>target_start_minute)) AT TIME ZONE target_timezone AS occurrence_starts,
      ((d::DATE+make_interval(mins=>target_start_minute)) AT TIME ZONE target_timezone)+make_interval(mins=>target_duration) AS occurrence_ends
    FROM generate_series(target_effective_start,LEAST(coalesce(target_effective_end,target_effective_start+1095),target_effective_start+1095),interval '1 day')d
    WHERE extract(isodow FROM d)=target_day AND (target_frequency='WEEKLY' OR mod(((d::DATE-target_effective_start)/7),2)=0)
  ) SELECT EXISTS(
    SELECT 1
    FROM candidate c
    JOIN public.list_coparent_living_occurrences(
      target_family_id,
      c.occurrence_starts-interval '1 second',
      c.occurrence_ends+interval '1 second'
    ) o ON o."startsAt"<c.occurrence_ends AND o."endsAt">c.occurrence_starts
    WHERE o."childIds"&&target_child_ids
  ) INTO conflict_exists;
  IF conflict_exists THEN RAISE EXCEPTION 'Living arrangement conflicts with an existing schedule' USING ERRCODE='23P01'; END IF;
  INSERT INTO public."LivingArrangement"("id","familyId","createdById","createdAt")VALUES(target_id,target_family_id,actor,timezone('UTC',clock_timestamp()));
  INSERT INTO public."LivingArrangementVersion"("id","arrangementId","revision","label","frequency","dayOfWeek","startMinute","durationMinutes","effectiveStart","effectiveEnd","timeZone","responsibleParentId","changedById","createdAt")VALUES(target_version_id,target_id,1,btrim(target_label),target_frequency::public."ArrangementFrequency",target_day,target_start_minute,target_duration,target_effective_start,target_effective_end,target_timezone,target_parent_id,actor,timezone('UTC',clock_timestamp()));
  INSERT INTO public."LivingArrangementVersionChild" SELECT target_version_id,c FROM unnest(target_child_ids)c;
  PERFORM set_config('app.arrangement_transition_id',target_id,TRUE); UPDATE public."LivingArrangement" SET "currentVersionId"=target_version_id WHERE "id"=target_id; PERFORM set_config('app.arrangement_transition_id','',TRUE);
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt")VALUES(gen_random_uuid()::TEXT,target_family_id,actor,'LIVING_ARRANGEMENT_CREATED','LivingArrangement',target_id,timezone('UTC',clock_timestamp())); RETURN target_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END; $$;

CREATE FUNCTION skip_coparent_living_occurrence(target_exception_id TEXT,target_arrangement_id TEXT,target_family_id TEXT,target_date DATE,target_reason TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id();
BEGIN IF actor IS NULL OR NOT public.is_coparent_family_member(target_family_id,TRUE) OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500 OR NOT EXISTS(SELECT 1 FROM public."LivingArrangement"a WHERE a."id"=target_arrangement_id AND a."familyId"=target_family_id) THEN RETURN NULL; END IF;
INSERT INTO public."LivingArrangementException"VALUES(target_exception_id,target_arrangement_id,target_date,btrim(target_reason),actor,timezone('UTC',clock_timestamp()));
INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata")VALUES(gen_random_uuid()::TEXT,target_family_id,actor,'LIVING_ARRANGEMENT_EXCEPTION_CREATED','LivingArrangement',target_arrangement_id,timezone('UTC',clock_timestamp()),jsonb_build_object('date',target_date)); RETURN target_exception_id; END; $$;

REVOKE ALL ON FUNCTION list_coparent_living_occurrences(TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC; REVOKE ALL ON FUNCTION create_coparent_living_arrangement(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,DATE,DATE,TEXT,TEXT,TEXT[]) FROM PUBLIC; REVOKE ALL ON FUNCTION skip_coparent_living_occurrence(TEXT,TEXT,TEXT,DATE,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_coparent_living_occurrences(TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO coparent_runtime; GRANT EXECUTE ON FUNCTION create_coparent_living_arrangement(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,INTEGER,INTEGER,DATE,DATE,TEXT,TEXT,TEXT[]) TO coparent_runtime; GRANT EXECUTE ON FUNCTION skip_coparent_living_occurrence(TEXT,TEXT,TEXT,DATE,TEXT) TO coparent_runtime;
GRANT SELECT ON "LivingArrangement","LivingArrangementVersion","LivingArrangementVersionChild","LivingArrangementException" TO coparent_runtime;
