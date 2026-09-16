CREATE OR REPLACE FUNCTION list_coparent_living_occurrences(
  target_family_id TEXT,
  target_from TIMESTAMPTZ,
  target_to TIMESTAMPTZ
)
RETURNS TABLE (
  "arrangementId" TEXT, "versionId" TEXT, "occurrenceDate" DATE,
  "label" TEXT, "startsAt" TIMESTAMPTZ, "endsAt" TIMESTAMPTZ,
  "timeZone" TEXT, "responsibleParentId" TEXT, "childIds" TEXT[]
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog SET timezone='UTC' AS $$
  SELECT a."id", v."id", d::DATE, v."label",
    (d::DATE + make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone",
    ((d::DATE + make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone")
      + make_interval(mins=>v."durationMinutes"),
    v."timeZone", v."responsibleParentId",
    array_agg(vc."childId" ORDER BY vc."childId")
  FROM public."LivingArrangement" a
  JOIN public."LivingArrangementVersion" v ON v."id"=a."currentVersionId"
  JOIN public."LivingArrangementVersionChild" vc ON vc."versionId"=v."id"
  CROSS JOIN LATERAL generate_series(
    GREATEST(v."effectiveStart",(target_from AT TIME ZONE v."timeZone")::DATE),
    LEAST(
      coalesce(v."effectiveEnd",(target_to AT TIME ZONE v."timeZone")::DATE),
      (target_to AT TIME ZONE v."timeZone")::DATE
    ), interval '1 day'
  ) d
  WHERE a."familyId"=target_family_id
    AND public.is_coparent_family_member(a."familyId")
    AND v."state"='ACTIVE'
    AND NOT coalesce(
      a."id" = ANY(string_to_array(
        nullif(current_setting('app.arrangement_batch_ids',TRUE),''), ','
      )), FALSE
    )
    AND extract(isodow FROM d)=v."dayOfWeek"
    AND (v."frequency"='WEEKLY' OR mod(((d::DATE-v."effectiveStart")/7),2)=0)
    AND NOT EXISTS (
      SELECT 1 FROM public."LivingArrangementException" e
      WHERE e."arrangementId"=a."id" AND e."occurrenceDate"=d::DATE
    )
    AND ((d::DATE+make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone") < target_to
    AND (((d::DATE+make_interval(mins=>v."startMinute")) AT TIME ZONE v."timeZone")
      + make_interval(mins=>v."durationMinutes")) > target_from
  GROUP BY a."id",v."id",d
$$;

REVOKE ALL ON FUNCTION list_coparent_living_occurrences(TEXT,TIMESTAMPTZ,TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_coparent_living_occurrences(TEXT,TIMESTAMPTZ,TIMESTAMPTZ) TO coparent_runtime;
