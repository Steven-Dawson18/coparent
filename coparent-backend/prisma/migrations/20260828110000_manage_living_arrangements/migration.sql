CREATE FUNCTION cancel_coparent_living_arrangement(
  target_arrangement_id TEXT,
  target_version_id TEXT,
  target_family_id TEXT,
  target_reason TEXT
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE
  actor TEXT := public.current_coparent_user_id();
  current_version public."LivingArrangementVersion"%ROWTYPE;
BEGIN
  IF actor IS NULL
    OR NOT public.is_coparent_family_member(target_family_id, TRUE)
    OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500
  THEN RETURN NULL;
  END IF;

  SELECT v.* INTO current_version
  FROM public."LivingArrangement" a
  JOIN public."LivingArrangementVersion" v ON v."id" = a."currentVersionId"
  WHERE a."id" = target_arrangement_id
    AND a."familyId" = target_family_id
    AND v."state" = 'ACTIVE'
  FOR UPDATE OF a;

  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO public."LivingArrangementVersion"(
    "id", "arrangementId", "revision", "state", "label", "frequency",
    "dayOfWeek", "startMinute", "durationMinutes", "effectiveStart",
    "effectiveEnd", "timeZone", "responsibleParentId", "changedById",
    "changeReason", "createdAt"
  ) VALUES (
    target_version_id, target_arrangement_id, current_version."revision" + 1,
    'CANCELLED', current_version."label", current_version."frequency",
    current_version."dayOfWeek", current_version."startMinute",
    current_version."durationMinutes", current_version."effectiveStart",
    current_version."effectiveEnd", current_version."timeZone",
    current_version."responsibleParentId", actor, btrim(target_reason),
    timezone('UTC', clock_timestamp())
  );

  INSERT INTO public."LivingArrangementVersionChild"("versionId", "childId")
  SELECT target_version_id, "childId"
  FROM public."LivingArrangementVersionChild"
  WHERE "versionId" = current_version."id";

  PERFORM set_config('app.arrangement_transition_id', target_arrangement_id, TRUE);
  UPDATE public."LivingArrangement"
  SET "currentVersionId" = target_version_id
  WHERE "id" = target_arrangement_id;
  PERFORM set_config('app.arrangement_transition_id', '', TRUE);

  INSERT INTO public."AuditEvent"(
    "id", "familyId", "actorId", "action", "entityType", "entityId",
    "occurredAt", "metadata"
  ) VALUES (
    gen_random_uuid()::TEXT, target_family_id, actor,
    'LIVING_ARRANGEMENT_CANCELLED', 'LivingArrangement', target_arrangement_id,
    timezone('UTC', clock_timestamp()), jsonb_build_object('reason', btrim(target_reason))
  );

  RETURN target_arrangement_id;
END; $$;

REVOKE ALL ON FUNCTION cancel_coparent_living_arrangement(TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_coparent_living_arrangement(TEXT,TEXT,TEXT,TEXT) TO coparent_runtime;
