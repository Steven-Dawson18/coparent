CREATE TYPE "FamilyRequestType" AS ENUM (
  'ARRANGEMENT_SWAP', 'HOLIDAY', 'SCHOOL', 'MEDICAL', 'ACTIVITY', 'PURCHASE', 'OTHER'
);
CREATE TYPE "FamilyRequestStatus" AS ENUM ('OPEN', 'COUNTERED', 'ACCEPTED', 'DECLINED');
CREATE TYPE "RequestResponseType" AS ENUM ('ACCEPT', 'DECLINE', 'COUNTER_PROPOSAL');

CREATE TABLE "FamilyRequest" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "respondentId" TEXT NOT NULL,
  "type" "FamilyRequestType" NOT NULL,
  "title" TEXT NOT NULL,
  "details" TEXT NOT NULL,
  "responseDeadlineAt" TIMESTAMP(3),
  "status" "FamilyRequestStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "FamilyRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FamilyRequest_different_parties_check" CHECK ("createdById" <> "respondentId"),
  CONSTRAINT "FamilyRequest_title_length_check" CHECK (char_length("title") BETWEEN 1 AND 160),
  CONSTRAINT "FamilyRequest_details_length_check" CHECK (char_length("details") BETWEEN 1 AND 5000),
  CONSTRAINT "FamilyRequest_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FamilyRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FamilyRequest_respondentId_fkey" FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "FamilyRequestChild" (
  "requestId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  CONSTRAINT "FamilyRequestChild_pkey" PRIMARY KEY ("requestId", "childId"),
  CONSTRAINT "FamilyRequestChild_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FamilyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FamilyRequestChild_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RequestResponse" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "responderId" TEXT NOT NULL,
  "type" "RequestResponseType" NOT NULL,
  "details" TEXT,
  "respondsToId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RequestResponse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "RequestResponse_details_length_check" CHECK ("details" IS NULL OR char_length("details") BETWEEN 1 AND 5000),
  CONSTRAINT "RequestResponse_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FamilyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequestResponse_responderId_fkey" FOREIGN KEY ("responderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "RequestResponse_respondsToId_fkey" FOREIGN KEY ("respondsToId") REFERENCES "RequestResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Agreement" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "acceptedResponseId" TEXT NOT NULL,
  "type" "FamilyRequestType" NOT NULL,
  "title" TEXT NOT NULL,
  "terms" TEXT NOT NULL,
  "agreedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Agreement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Agreement_requestId_key" UNIQUE ("requestId"),
  CONSTRAINT "Agreement_acceptedResponseId_key" UNIQUE ("acceptedResponseId"),
  CONSTRAINT "Agreement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "FamilyRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Agreement_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Agreement_acceptedResponseId_fkey" FOREIGN KEY ("acceptedResponseId") REFERENCES "RequestResponse"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "FamilyRequest_familyId_status_createdAt_idx" ON "FamilyRequest"("familyId", "status", "createdAt");
CREATE INDEX "FamilyRequest_respondentId_status_idx" ON "FamilyRequest"("respondentId", "status");
CREATE INDEX "FamilyRequestChild_childId_idx" ON "FamilyRequestChild"("childId");
CREATE INDEX "RequestResponse_requestId_createdAt_idx" ON "RequestResponse"("requestId", "createdAt");
CREATE INDEX "RequestResponse_responderId_createdAt_idx" ON "RequestResponse"("responderId", "createdAt");
CREATE INDEX "Agreement_familyId_agreedAt_idx" ON "Agreement"("familyId", "agreedAt");

ALTER TABLE "FamilyRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FamilyRequestChild" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RequestResponse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Agreement" ENABLE ROW LEVEL SECURITY;

CREATE POLICY family_request_select ON "FamilyRequest" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("familyId"));
CREATE POLICY family_request_child_select ON "FamilyRequestChild" FOR SELECT TO coparent_runtime
  USING (EXISTS (
    SELECT 1 FROM "FamilyRequest" request
    WHERE request."id" = "requestId" AND is_coparent_family_member(request."familyId")
  ));
CREATE POLICY request_response_select ON "RequestResponse" FOR SELECT TO coparent_runtime
  USING (EXISTS (
    SELECT 1 FROM "FamilyRequest" request
    WHERE request."id" = "requestId" AND is_coparent_family_member(request."familyId")
  ));
CREATE POLICY agreement_select ON "Agreement" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("familyId"));

CREATE FUNCTION protect_family_request_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Request records are immutable'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."createdById" IS DISTINCT FROM OLD."createdById"
    OR NEW."respondentId" IS DISTINCT FROM OLD."respondentId"
    OR NEW."type" IS DISTINCT FROM OLD."type"
    OR NEW."title" IS DISTINCT FROM OLD."title"
    OR NEW."details" IS DISTINCT FROM OLD."details"
    OR NEW."responseDeadlineAt" IS DISTINCT FROM OLD."responseDeadlineAt"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN RAISE EXCEPTION 'Request proposal content is immutable'; END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION prevent_request_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Request history is immutable';
END;
$$;

CREATE TRIGGER family_request_protected BEFORE UPDATE OR DELETE ON "FamilyRequest"
FOR EACH ROW EXECUTE FUNCTION protect_family_request_record();
CREATE TRIGGER family_request_child_immutable BEFORE UPDATE OR DELETE ON "FamilyRequestChild"
FOR EACH ROW EXECUTE FUNCTION prevent_request_history_mutation();
CREATE TRIGGER request_response_immutable BEFORE UPDATE OR DELETE ON "RequestResponse"
FOR EACH ROW EXECUTE FUNCTION prevent_request_history_mutation();
CREATE TRIGGER agreement_immutable BEFORE UPDATE OR DELETE ON "Agreement"
FOR EACH ROW EXECUTE FUNCTION prevent_request_history_mutation();

CREATE FUNCTION create_coparent_family_request(
  target_request_id TEXT, target_family_id TEXT, target_respondent_id TEXT,
  target_type TEXT, target_title TEXT, target_details TEXT,
  target_deadline TIMESTAMP(3), target_child_ids TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  normalized_title TEXT := btrim(target_title);
  normalized_details TEXT := btrim(target_details);
  distinct_child_count INTEGER;
BEGIN
  IF actor_id IS NULL OR actor_id = target_respondent_id
    OR NOT public.is_coparent_family_member(target_family_id, TRUE)
    OR NOT EXISTS (
      SELECT 1 FROM public."FamilyMembership" membership
      WHERE membership."familyId" = target_family_id
        AND membership."userId" = target_respondent_id
        AND membership."role" IN ('OWNER'::public."FamilyRole", 'PARENT'::public."FamilyRole")
    )
    OR char_length(normalized_title) NOT BETWEEN 1 AND 160
    OR char_length(normalized_details) NOT BETWEEN 1 AND 5000
    OR (target_deadline IS NOT NULL AND target_deadline <= timezone('UTC', clock_timestamp()))
  THEN RETURN NULL; END IF;

  SELECT count(DISTINCT child_id) INTO distinct_child_count FROM unnest(target_child_ids) AS child_id;
  IF distinct_child_count <> coalesce(array_length(target_child_ids, 1), 0) OR EXISTS (
    SELECT 1 FROM unnest(target_child_ids) AS child_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public."Child" child
      WHERE child."id" = child_id AND child."familyId" = target_family_id
    )
  ) THEN RETURN NULL; END IF;

  INSERT INTO public."FamilyRequest" (
    "id", "familyId", "createdById", "respondentId", "type", "title", "details",
    "responseDeadlineAt", "createdAt"
  ) VALUES (
    target_request_id, target_family_id, actor_id, target_respondent_id,
    target_type::public."FamilyRequestType", normalized_title, normalized_details,
    target_deadline, timezone('UTC', clock_timestamp())
  );
  INSERT INTO public."FamilyRequestChild" ("requestId", "childId")
  SELECT target_request_id, child_id FROM unnest(target_child_ids) AS child_id;
  INSERT INTO public."AuditEvent" (
    "id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata"
  ) VALUES (
    gen_random_uuid()::TEXT, target_family_id, actor_id, 'REQUEST_CREATED', 'FamilyRequest',
    target_request_id, timezone('UTC', clock_timestamp()),
    jsonb_build_object('type', target_type, 'respondentId', target_respondent_id, 'childCount', distinct_child_count)
  );
  RETURN target_request_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;

CREATE FUNCTION respond_to_coparent_family_request(
  target_request_id TEXT, target_response_id TEXT, target_response_type TEXT,
  target_details TEXT, target_agreement_id TEXT
) RETURNS TABLE ("requestId" TEXT, "status" public."FamilyRequestStatus", "agreementId" TEXT)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  request_record public."FamilyRequest"%ROWTYPE;
  counter_record public."RequestResponse"%ROWTYPE;
  response_type public."RequestResponseType";
  normalized_details TEXT := nullif(btrim(target_details), '');
  new_status public."FamilyRequestStatus";
  agreement_terms TEXT;
  created_agreement_id TEXT;
BEGIN
  response_type := target_response_type::public."RequestResponseType";
  SELECT candidate.* INTO request_record FROM public."FamilyRequest" candidate
  WHERE candidate."id" = target_request_id FOR UPDATE;
  IF NOT FOUND OR actor_id IS NULL OR NOT public.is_coparent_family_member(request_record."familyId", TRUE)
    OR (request_record."responseDeadlineAt" IS NOT NULL AND request_record."responseDeadlineAt" <= timezone('UTC', clock_timestamp()))
  THEN RETURN; END IF;

  IF request_record."status" = 'OPEN'::public."FamilyRequestStatus" THEN
    IF actor_id <> request_record."respondentId" THEN RETURN; END IF;
    IF response_type = 'COUNTER_PROPOSAL'::public."RequestResponseType" THEN
      IF normalized_details IS NULL OR char_length(normalized_details) > 5000 THEN RETURN; END IF;
      new_status := 'COUNTERED'::public."FamilyRequestStatus";
    ELSIF response_type = 'ACCEPT'::public."RequestResponseType" THEN
      new_status := 'ACCEPTED'::public."FamilyRequestStatus";
      agreement_terms := request_record."details";
    ELSIF response_type = 'DECLINE'::public."RequestResponseType" THEN
      new_status := 'DECLINED'::public."FamilyRequestStatus";
    ELSE RETURN;
    END IF;
  ELSIF request_record."status" = 'COUNTERED'::public."FamilyRequestStatus" THEN
    IF actor_id <> request_record."createdById"
      OR response_type NOT IN ('ACCEPT'::public."RequestResponseType", 'DECLINE'::public."RequestResponseType")
    THEN RETURN; END IF;
    SELECT response.* INTO counter_record FROM public."RequestResponse" response
    WHERE response."requestId" = target_request_id
      AND response."type" = 'COUNTER_PROPOSAL'::public."RequestResponseType"
    ORDER BY response."createdAt" DESC LIMIT 1;
    IF NOT FOUND THEN RETURN; END IF;
    new_status := CASE WHEN response_type = 'ACCEPT'::public."RequestResponseType"
      THEN 'ACCEPTED'::public."FamilyRequestStatus" ELSE 'DECLINED'::public."FamilyRequestStatus" END;
    IF new_status = 'ACCEPTED'::public."FamilyRequestStatus" THEN agreement_terms := counter_record."details"; END IF;
  ELSE RETURN;
  END IF;

  INSERT INTO public."RequestResponse" (
    "id", "requestId", "responderId", "type", "details", "respondsToId", "createdAt"
  ) VALUES (
    target_response_id, target_request_id, actor_id, response_type, normalized_details,
    CASE WHEN request_record."status" = 'COUNTERED'::public."FamilyRequestStatus" THEN counter_record."id" ELSE NULL END,
    timezone('UTC', clock_timestamp())
  );
  UPDATE public."FamilyRequest" SET "status" = new_status,
    "resolvedAt" = CASE WHEN new_status IN ('ACCEPTED'::public."FamilyRequestStatus", 'DECLINED'::public."FamilyRequestStatus")
      THEN timezone('UTC', clock_timestamp()) ELSE NULL END
  WHERE "id" = target_request_id;

  IF new_status = 'ACCEPTED'::public."FamilyRequestStatus" THEN
    IF target_agreement_id IS NULL THEN RAISE EXCEPTION 'Agreement ID required'; END IF;
    INSERT INTO public."Agreement" (
      "id", "requestId", "familyId", "acceptedResponseId", "type", "title", "terms", "agreedAt"
    ) VALUES (
      target_agreement_id, target_request_id, request_record."familyId", target_response_id,
      request_record."type", request_record."title", agreement_terms, timezone('UTC', clock_timestamp())
    );
    created_agreement_id := target_agreement_id;
  END IF;

  INSERT INTO public."AuditEvent" (
    "id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata"
  ) VALUES (
    gen_random_uuid()::TEXT, request_record."familyId", actor_id,
    CASE new_status WHEN 'ACCEPTED' THEN 'REQUEST_ACCEPTED' WHEN 'DECLINED' THEN 'REQUEST_DECLINED' ELSE 'REQUEST_COUNTERED' END,
    'FamilyRequest', target_request_id, timezone('UTC', clock_timestamp()),
    jsonb_build_object('responseId', target_response_id)
  );
  RETURN QUERY SELECT target_request_id, new_status, created_agreement_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN;
END;
$$;

CREATE FUNCTION count_coparent_action_required_requests() RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog SET timezone = 'UTC'
AS $$
  SELECT count(*)::INTEGER FROM public."FamilyRequest" request
  WHERE public.is_coparent_family_member(request."familyId")
    AND (request."responseDeadlineAt" IS NULL OR request."responseDeadlineAt" > timezone('UTC', clock_timestamp()))
    AND (
      (request."status" = 'OPEN'::public."FamilyRequestStatus" AND request."respondentId" = public.current_coparent_user_id())
      OR (request."status" = 'COUNTERED'::public."FamilyRequestStatus" AND request."createdById" = public.current_coparent_user_id())
    )
$$;

REVOKE ALL ON FUNCTION protect_family_request_record() FROM PUBLIC;
REVOKE ALL ON FUNCTION prevent_request_history_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_coparent_family_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMP WITHOUT TIME ZONE, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION respond_to_coparent_family_request(TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION count_coparent_action_required_requests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_coparent_family_request(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TIMESTAMP WITHOUT TIME ZONE, TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION respond_to_coparent_family_request(TEXT, TEXT, TEXT, TEXT, TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION count_coparent_action_required_requests() TO coparent_runtime;
GRANT SELECT ON "FamilyRequest", "FamilyRequestChild", "RequestResponse", "Agreement" TO coparent_runtime;
