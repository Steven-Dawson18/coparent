CREATE TYPE "DocumentCategory" AS ENUM ('SCHOOL','MEDICAL','LEGAL','IDENTITY','RECEIPT','ACTIVITY','GENERAL');

CREATE TABLE "Document" (
  "id" TEXT PRIMARY KEY,
  "familyId" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE RESTRICT,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "expenseId" TEXT REFERENCES "Expense"("id") ON DELETE RESTRICT,
  "currentVersionId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "DocumentVersion" (
  "id" TEXT PRIMARY KEY,
  "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE RESTRICT,
  "revision" INTEGER NOT NULL,
  "category" "DocumentCategory" NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "originalFileName" TEXT NOT NULL,
  "mediaType" TEXT NOT NULL,
  "plaintextSize" INTEGER NOT NULL,
  "sha256" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL UNIQUE,
  "initializationVector" TEXT NOT NULL,
  "authenticationTag" TEXT NOT NULL,
  "encryptionKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "changedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "changeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("documentId","revision"),
  CHECK(char_length("title") BETWEEN 1 AND 200),
  CHECK("description" IS NULL OR char_length("description") BETWEEN 1 AND 5000),
  CHECK(char_length("originalFileName") BETWEEN 1 AND 255),
  CHECK(char_length("mediaType") BETWEEN 1 AND 160),
  CHECK("plaintextSize" BETWEEN 1 AND 10485760),
  CHECK("sha256" ~ '^[0-9a-f]{64}$'),
  CHECK("changeReason" IS NULL OR char_length("changeReason") BETWEEN 1 AND 500)
);
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE RESTRICT;
CREATE TABLE "DocumentChild" (
  "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE RESTRICT,
  "childId" TEXT NOT NULL REFERENCES "Child"("id") ON DELETE RESTRICT,
  PRIMARY KEY("documentId","childId")
);
CREATE INDEX "Document_familyId_createdAt_idx" ON "Document"("familyId","createdAt");
CREATE INDEX "Document_expenseId_idx" ON "Document"("expenseId");
CREATE INDEX "DocumentVersion_createdAt_idx" ON "DocumentVersion"("createdAt");
CREATE INDEX "DocumentChild_childId_idx" ON "DocumentChild"("childId");

ALTER TABLE "Document" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentChild" ENABLE ROW LEVEL SECURITY;
CREATE POLICY document_select ON "Document" FOR SELECT TO coparent_runtime USING(is_coparent_family_member("familyId"));
CREATE POLICY document_version_select ON "DocumentVersion" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "Document" d WHERE d."id"="documentId" AND is_coparent_family_member(d."familyId")));
CREATE POLICY document_child_select ON "DocumentChild" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "Document" d WHERE d."id"="documentId" AND is_coparent_family_member(d."familyId")));

CREATE FUNCTION protect_document_root() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Document records are permanent'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."familyId" IS DISTINCT FROM OLD."familyId" OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."expenseId" IS DISTINCT FROM OLD."expenseId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'Document identity is immutable'; END IF;
  IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId" AND nullif(current_setting('app.document_transition_id',TRUE),'') IS DISTINCT FROM OLD."id" THEN RAISE EXCEPTION 'Document versions may change only through a transition function'; END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION prevent_document_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Document history is immutable'; END; $$;
CREATE TRIGGER document_protected BEFORE UPDATE OR DELETE ON "Document" FOR EACH ROW EXECUTE FUNCTION protect_document_root();
CREATE TRIGGER document_version_immutable BEFORE UPDATE OR DELETE ON "DocumentVersion" FOR EACH ROW EXECUTE FUNCTION prevent_document_history_mutation();
CREATE TRIGGER document_child_immutable BEFORE UPDATE OR DELETE ON "DocumentChild" FOR EACH ROW EXECUTE FUNCTION prevent_document_history_mutation();

CREATE FUNCTION insert_coparent_document_version(target_version TEXT,target_document TEXT,target_revision INTEGER,target_category TEXT,target_title TEXT,target_description TEXT,target_filename TEXT,target_media_type TEXT,target_size INTEGER,target_sha256 TEXT,target_storage_key TEXT,target_iv TEXT,target_tag TEXT,target_key_version INTEGER,target_actor TEXT,target_reason TEXT) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
  IF char_length(btrim(target_title)) NOT BETWEEN 1 AND 200 OR target_size NOT BETWEEN 1 AND 10485760 OR target_sha256 !~ '^[0-9a-f]{64}$' THEN RETURN FALSE; END IF;
  INSERT INTO public."DocumentVersion"("id","documentId","revision","category","title","description","originalFileName","mediaType","plaintextSize","sha256","storageKey","initializationVector","authenticationTag","encryptionKeyVersion","changedById","changeReason","createdAt") VALUES(target_version,target_document,target_revision,target_category::public."DocumentCategory",btrim(target_title),nullif(btrim(target_description),''),target_filename,target_media_type,target_size,target_sha256,target_storage_key,target_iv,target_tag,target_key_version,target_actor,nullif(btrim(target_reason),''),timezone('UTC',clock_timestamp()));
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR unique_violation OR foreign_key_violation OR check_violation THEN RETURN FALSE;
END; $$;

CREATE FUNCTION create_coparent_document(target_id TEXT,target_version TEXT,target_family TEXT,target_expense TEXT,target_category TEXT,target_title TEXT,target_description TEXT,target_filename TEXT,target_media_type TEXT,target_size INTEGER,target_sha256 TEXT,target_storage_key TEXT,target_iv TEXT,target_tag TEXT,target_key_version INTEGER,target_children TEXT[]) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id(); ok BOOLEAN;
BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_member(target_family,TRUE)
    OR target_expense IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public."Expense" WHERE "id"=target_expense AND "familyId"=target_family)
    OR EXISTS(SELECT 1 FROM unnest(target_children)c WHERE NOT EXISTS(SELECT 1 FROM public."Child" WHERE "id"=c AND "familyId"=target_family)) THEN RETURN NULL; END IF;
  INSERT INTO public."Document"("id","familyId","createdById","expenseId","createdAt") VALUES(target_id,target_family,actor,target_expense,timezone('UTC',clock_timestamp()));
  INSERT INTO public."DocumentChild" SELECT target_id,c FROM unnest(target_children)c;
  SELECT public.insert_coparent_document_version(target_version,target_id,1,target_category,target_title,target_description,target_filename,target_media_type,target_size,target_sha256,target_storage_key,target_iv,target_tag,target_key_version,actor,NULL) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'Invalid document'; END IF;
  PERFORM set_config('app.document_transition_id',target_id,TRUE);
  UPDATE public."Document" SET "currentVersionId"=target_version WHERE "id"=target_id;
  PERFORM set_config('app.document_transition_id','',TRUE);
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'DOCUMENT_UPLOADED','Document',target_id,timezone('UTC',clock_timestamp()),jsonb_build_object('sha256',target_sha256,'mediaType',target_media_type,'size',target_size));
  RETURN target_id;
END; $$;

CREATE FUNCTION revise_coparent_document(target_id TEXT,target_version TEXT,target_family TEXT,target_category TEXT,target_title TEXT,target_description TEXT,target_filename TEXT,target_media_type TEXT,target_size INTEGER,target_sha256 TEXT,target_storage_key TEXT,target_iv TEXT,target_tag TEXT,target_key_version INTEGER,target_reason TEXT) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id(); rev INTEGER; ok BOOLEAN;
BEGIN
  SELECT v."revision" INTO rev FROM public."Document" d JOIN public."DocumentVersion" v ON v."id"=d."currentVersionId" WHERE d."id"=target_id AND d."familyId"=target_family FOR UPDATE OF d;
  IF rev IS NULL OR NOT public.is_coparent_family_member(target_family,TRUE) OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500 THEN RETURN NULL; END IF;
  SELECT public.insert_coparent_document_version(target_version,target_id,rev+1,target_category,target_title,target_description,target_filename,target_media_type,target_size,target_sha256,target_storage_key,target_iv,target_tag,target_key_version,actor,target_reason) INTO ok;
  IF NOT ok THEN RAISE EXCEPTION 'Invalid document revision'; END IF;
  PERFORM set_config('app.document_transition_id',target_id,TRUE);
  UPDATE public."Document" SET "currentVersionId"=target_version WHERE "id"=target_id;
  PERFORM set_config('app.document_transition_id','',TRUE);
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'DOCUMENT_VERSION_UPLOADED','Document',target_id,timezone('UTC',clock_timestamp()),jsonb_build_object('revision',rev+1,'sha256',target_sha256));
  RETURN target_id;
END; $$;

CREATE FUNCTION audit_coparent_document_download(target_id TEXT,target_family TEXT,target_version TEXT) RETURNS BOOLEAN LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id();
BEGIN
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public."Document" d JOIN public."DocumentVersion" v ON v."documentId"=d."id" WHERE d."id"=target_id AND d."familyId"=target_family AND v."id"=target_version AND public.is_coparent_family_member(d."familyId")) THEN RETURN FALSE; END IF;
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'DOCUMENT_DOWNLOADED','Document',target_id,timezone('UTC',clock_timestamp()),jsonb_build_object('versionId',target_version));
  RETURN TRUE;
END; $$;

REVOKE ALL ON FUNCTION insert_coparent_document_version(TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_coparent_document(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION revise_coparent_document(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_coparent_document_download(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_coparent_document(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revise_coparent_document(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION audit_coparent_document_download(TEXT,TEXT,TEXT) TO coparent_runtime;
GRANT SELECT ON "Document","DocumentVersion","DocumentChild" TO coparent_runtime;
