CREATE TABLE "DocumentMessage" (
  "documentId" TEXT PRIMARY KEY REFERENCES "Document"("id") ON DELETE RESTRICT,
  "messageId" TEXT NOT NULL REFERENCES "Message"("id") ON DELETE RESTRICT
);
CREATE TABLE "DocumentFamilyRequest" (
  "documentId" TEXT PRIMARY KEY REFERENCES "Document"("id") ON DELETE RESTRICT,
  "requestId" TEXT NOT NULL REFERENCES "FamilyRequest"("id") ON DELETE RESTRICT
);
CREATE TABLE "DocumentRequestResponse" (
  "documentId" TEXT PRIMARY KEY REFERENCES "Document"("id") ON DELETE RESTRICT,
  "responseId" TEXT NOT NULL REFERENCES "RequestResponse"("id") ON DELETE RESTRICT
);
CREATE INDEX "DocumentMessage_messageId_idx" ON "DocumentMessage"("messageId");
CREATE INDEX "DocumentFamilyRequest_requestId_idx" ON "DocumentFamilyRequest"("requestId");
CREATE INDEX "DocumentRequestResponse_responseId_idx" ON "DocumentRequestResponse"("responseId");

ALTER TABLE "DocumentMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentFamilyRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentRequestResponse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_message_select ON "DocumentMessage" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "Message" m WHERE m."id"="messageId" AND is_coparent_family_member(m."familyId")));
CREATE POLICY document_request_select ON "DocumentFamilyRequest" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "FamilyRequest" r WHERE r."id"="requestId" AND is_coparent_family_member(r."familyId")));
CREATE POLICY document_response_select ON "DocumentRequestResponse" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "RequestResponse" rr JOIN "FamilyRequest" r ON r."id"=rr."requestId" WHERE rr."id"="responseId" AND is_coparent_family_member(r."familyId")));
CREATE TRIGGER document_message_immutable BEFORE UPDATE OR DELETE ON "DocumentMessage" FOR EACH ROW EXECUTE FUNCTION prevent_document_history_mutation();
CREATE TRIGGER document_request_immutable BEFORE UPDATE OR DELETE ON "DocumentFamilyRequest" FOR EACH ROW EXECUTE FUNCTION prevent_document_history_mutation();
CREATE TRIGGER document_response_immutable BEFORE UPDATE OR DELETE ON "DocumentRequestResponse" FOR EACH ROW EXECUTE FUNCTION prevent_document_history_mutation();
CREATE FUNCTION prevent_attached_document_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM public."DocumentMessage" WHERE "documentId"=NEW."documentId")
    OR EXISTS(SELECT 1 FROM public."DocumentFamilyRequest" WHERE "documentId"=NEW."documentId")
    OR EXISTS(SELECT 1 FROM public."DocumentRequestResponse" WHERE "documentId"=NEW."documentId")
  THEN RAISE EXCEPTION USING ERRCODE='23514', MESSAGE='Attached document content is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER attached_document_version_frozen BEFORE INSERT ON "DocumentVersion" FOR EACH ROW EXECUTE FUNCTION prevent_attached_document_revision();

CREATE FUNCTION attach_coparent_documents(target_family TEXT,target_entity_type TEXT,target_entity_id TEXT,target_documents TEXT[]) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id(); distinct_count INTEGER;
BEGIN
  IF coalesce(array_length(target_documents,1),0)>10 THEN RETURN FALSE; END IF;
  SELECT count(DISTINCT id) INTO distinct_count FROM unnest(target_documents) id;
  IF distinct_count<>coalesce(array_length(target_documents,1),0) THEN RETURN FALSE; END IF;
  PERFORM 1 FROM public."Document" d WHERE d."id"=ANY(target_documents) ORDER BY d."id" FOR UPDATE;
  IF EXISTS(SELECT 1 FROM unnest(target_documents) id WHERE NOT EXISTS(
    SELECT 1 FROM public."Document" d WHERE d."id"=id AND d."familyId"=target_family
      AND d."createdById"=actor AND d."expenseId" IS NULL AND d."currentVersionId" IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM public."DocumentMessage" x WHERE x."documentId"=d."id")
      AND NOT EXISTS(SELECT 1 FROM public."DocumentFamilyRequest" x WHERE x."documentId"=d."id")
      AND NOT EXISTS(SELECT 1 FROM public."DocumentRequestResponse" x WHERE x."documentId"=d."id")
  )) THEN RETURN FALSE; END IF;
  IF target_entity_type='MESSAGE' THEN
    INSERT INTO public."DocumentMessage" SELECT id,target_entity_id FROM unnest(target_documents) id;
  ELSIF target_entity_type='REQUEST' THEN
    INSERT INTO public."DocumentFamilyRequest" SELECT id,target_entity_id FROM unnest(target_documents) id;
  ELSIF target_entity_type='RESPONSE' THEN
    INSERT INTO public."DocumentRequestResponse" SELECT id,target_entity_id FROM unnest(target_documents) id;
  ELSE RETURN FALSE; END IF;
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata")
    SELECT gen_random_uuid()::TEXT,target_family,actor,'DOCUMENT_ATTACHED','Document',id,timezone('UTC',clock_timestamp()),jsonb_build_object('attachedToType',target_entity_type,'attachedToId',target_entity_id) FROM unnest(target_documents) id;
  RETURN TRUE;
EXCEPTION WHEN unique_violation OR foreign_key_violation THEN RETURN FALSE;
END; $$;

CREATE FUNCTION create_coparent_message_with_attachments(target_message_id TEXT,target_family_id TEXT,target_category TEXT,target_body TEXT,target_child_ids TEXT[],target_document_ids TEXT[]) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE created TEXT; attached BOOLEAN;
BEGIN
  SELECT public.create_coparent_message(target_message_id,target_family_id,target_category,target_body,target_child_ids) INTO created;
  IF created IS NULL THEN RETURN NULL; END IF;
  SELECT public.attach_coparent_documents(target_family_id,'MESSAGE',created,target_document_ids) INTO attached;
  IF NOT attached THEN RAISE EXCEPTION 'Invalid attachments'; END IF;
  RETURN created;
EXCEPTION WHEN raise_exception THEN RETURN NULL;
END; $$;

CREATE FUNCTION create_coparent_family_request_with_attachments(target_request_id TEXT,target_family_id TEXT,target_respondent_id TEXT,target_type TEXT,target_title TEXT,target_details TEXT,target_deadline TIMESTAMP(3),target_child_ids TEXT[],target_document_ids TEXT[]) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE created TEXT; attached BOOLEAN;
BEGIN
  SELECT public.create_coparent_family_request(target_request_id,target_family_id,target_respondent_id,target_type,target_title,target_details,target_deadline,target_child_ids) INTO created;
  IF created IS NULL THEN RETURN NULL; END IF;
  SELECT public.attach_coparent_documents(target_family_id,'REQUEST',created,target_document_ids) INTO attached;
  IF NOT attached THEN RAISE EXCEPTION 'Invalid attachments'; END IF;
  RETURN created;
EXCEPTION WHEN raise_exception THEN RETURN NULL;
END; $$;

CREATE FUNCTION respond_to_coparent_family_request_with_attachments(target_request_id TEXT,target_response_id TEXT,target_response_type TEXT,target_details TEXT,target_agreement_id TEXT,target_document_ids TEXT[]) RETURNS TABLE("requestId" TEXT,"status" public."FamilyRequestStatus","agreementId" TEXT) LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE result RECORD; attached BOOLEAN; family_id TEXT;
BEGIN
  SELECT * INTO result FROM public.respond_to_coparent_family_request(target_request_id,target_response_id,target_response_type,target_details,target_agreement_id);
  IF NOT FOUND THEN RETURN; END IF;
  SELECT "familyId" INTO family_id FROM public."FamilyRequest" WHERE "id"=target_request_id;
  SELECT public.attach_coparent_documents(family_id,'RESPONSE',target_response_id,target_document_ids) INTO attached;
  IF NOT attached THEN RAISE EXCEPTION 'Invalid attachments'; END IF;
  RETURN QUERY SELECT result."requestId"::TEXT,result."status"::public."FamilyRequestStatus",result."agreementId"::TEXT;
EXCEPTION WHEN raise_exception THEN RETURN;
END; $$;

REVOKE ALL ON FUNCTION attach_coparent_documents(TEXT,TEXT,TEXT,TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_coparent_message_with_attachments(TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_coparent_family_request_with_attachments(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMP WITHOUT TIME ZONE,TEXT[],TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION respond_to_coparent_family_request_with_attachments(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_coparent_message_with_attachments(TEXT,TEXT,TEXT,TEXT,TEXT[],TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION create_coparent_family_request_with_attachments(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TIMESTAMP WITHOUT TIME ZONE,TEXT[],TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION respond_to_coparent_family_request_with_attachments(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT[]) TO coparent_runtime;
GRANT SELECT ON "DocumentMessage","DocumentFamilyRequest","DocumentRequestResponse" TO coparent_runtime;
