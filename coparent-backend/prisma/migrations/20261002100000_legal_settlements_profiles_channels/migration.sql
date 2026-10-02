CREATE TYPE "ProfessionalType" AS ENUM ('SOLICITOR','MEDIATOR','COURT_APPOINTED','OTHER');
CREATE TYPE "ProfessionalScope" AS ENUM ('CASE_OVERVIEW','MESSAGES','REQUESTS','AGREEMENTS','CALENDAR','HANDOVERS','EXPENSES','DOCUMENTS','AUDIT','EVIDENCE');
CREATE TYPE "DocumentVisibility" AS ENUM ('FAMILY','PARENTS_ONLY','EXPLICIT_GRANTS');
CREATE TYPE "LegalCaseStatus" AS ENUM ('ACTIVE','STAYED','CLOSED');
CREATE TYPE "LegalDisclosureStatus" AS ENUM ('AWAITING_APPROVAL','APPROVED','REVOKED','EXPIRED');
CREATE TYPE "SettlementMethod" AS ENUM ('BANK_TRANSFER','CASH','CARD','OTHER');
CREATE TYPE "NotificationEndpointChannel" AS ENUM ('PUSH','SMS');
ALTER TYPE "DocumentCategory" ADD VALUE 'COURT_ORDER';
ALTER TYPE "DocumentCategory" ADD VALUE 'PARENTING_AGREEMENT';

ALTER TABLE "FamilyMembership"
  ADD COLUMN "professionalType" "ProfessionalType",
  ADD COLUMN "professionalScopes" "ProfessionalScope"[] NOT NULL DEFAULT ARRAY[]::"ProfessionalScope"[],
  ADD CONSTRAINT "FamilyMembership_professional_fields_check" CHECK (
    ("role" = 'PROFESSIONAL_READ_ONLY' AND "professionalType" IS NOT NULL)
    OR ("role" <> 'PROFESSIONAL_READ_ONLY' AND "professionalType" IS NULL AND cardinality("professionalScopes") = 0)
  ) NOT VALID;
UPDATE "FamilyMembership"
SET "professionalType" = 'OTHER',
    "professionalScopes" = ARRAY['CASE_OVERVIEW','MESSAGES','REQUESTS','AGREEMENTS','CALENDAR','HANDOVERS','EXPENSES','DOCUMENTS','AUDIT','EVIDENCE']::"ProfessionalScope"[]
WHERE "role" = 'PROFESSIONAL_READ_ONLY';
ALTER TABLE "FamilyMembership" VALIDATE CONSTRAINT "FamilyMembership_professional_fields_check";
CREATE FUNCTION default_coparent_professional_access() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW."role"='PROFESSIONAL_READ_ONLY' AND NEW."professionalType" IS NULL THEN
    NEW."professionalType":='OTHER';
    NEW."professionalScopes":=ARRAY['CASE_OVERVIEW']::public."ProfessionalScope"[];
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER family_membership_professional_defaults BEFORE INSERT ON "FamilyMembership" FOR EACH ROW EXECUTE FUNCTION default_coparent_professional_access();

CREATE OR REPLACE FUNCTION protect_family_membership_access() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Family membership history cannot be deleted'; END IF;
  IF NEW."familyId" IS DISTINCT FROM OLD."familyId"
    OR NEW."userId" IS DISTINCT FROM OLD."userId"
    OR NEW."role" IS DISTINCT FROM OLD."role"
    OR NEW."joinedAt" IS DISTINCT FROM OLD."joinedAt"
  THEN RAISE EXCEPTION 'Family membership identity is immutable'; END IF;
  IF (
    NEW."accessExpiresAt" IS DISTINCT FROM OLD."accessExpiresAt"
    OR NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt"
    OR NEW."revocationReason" IS DISTINCT FROM OLD."revocationReason"
    OR NEW."professionalType" IS DISTINCT FROM OLD."professionalType"
    OR NEW."professionalScopes" IS DISTINCT FROM OLD."professionalScopes"
  ) AND NULLIF(current_setting('app.professional_access_transition_user_id',TRUE),'') IS DISTINCT FROM OLD."userId"
  THEN RAISE EXCEPTION 'Professional access may change only through a controlled transition'; END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "Child"
  ADD COLUMN "contactInformation" TEXT,
  ADD COLUMN "emergencyContactName" TEXT,
  ADD COLUMN "emergencyContactRelationship" TEXT,
  ADD COLUMN "emergencyContactPhone" TEXT,
  ADD COLUMN "gpName" TEXT,
  ADD COLUMN "gpPhone" TEXT,
  ADD COLUMN "dentistName" TEXT,
  ADD COLUMN "dentistPhone" TEXT,
  ADD COLUMN "medicalNotes" TEXT,
  ADD COLUMN "clubsAndActivities" TEXT,
  ADD CONSTRAINT "Child_profile_lengths_check" CHECK (
    ("contactInformation" IS NULL OR char_length("contactInformation") <= 2000)
    AND ("emergencyContactName" IS NULL OR char_length("emergencyContactName") <= 200)
    AND ("emergencyContactRelationship" IS NULL OR char_length("emergencyContactRelationship") <= 100)
    AND ("emergencyContactPhone" IS NULL OR char_length("emergencyContactPhone") <= 50)
    AND ("gpName" IS NULL OR char_length("gpName") <= 200)
    AND ("gpPhone" IS NULL OR char_length("gpPhone") <= 50)
    AND ("dentistName" IS NULL OR char_length("dentistName") <= 200)
    AND ("dentistPhone" IS NULL OR char_length("dentistPhone") <= 50)
    AND ("medicalNotes" IS NULL OR char_length("medicalNotes") <= 5000)
    AND ("clubsAndActivities" IS NULL OR char_length("clubsAndActivities") <= 3000)
  );

ALTER TABLE "Document" ADD COLUMN "visibility" "DocumentVisibility" NOT NULL DEFAULT 'FAMILY';
ALTER TABLE "NotificationPreference"
  ADD COLUMN "pushEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "smsEnabled" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE "Settlement" (
  "id" TEXT PRIMARY KEY,
  "familyId" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE RESTRICT,
  "payerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "payeeId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "amountMinor" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'GBP',
  "paidAt" TIMESTAMPTZ(3) NOT NULL,
  "method" "SettlementMethod" NOT NULL,
  "reference" TEXT,
  "note" TEXT,
  "recordedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ("payerId" <> "payeeId"),
  CHECK ("amountMinor" BETWEEN 1 AND 100000000),
  CHECK ("currency" = 'GBP'),
  CHECK ("reference" IS NULL OR char_length("reference") BETWEEN 1 AND 200),
  CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 1000)
);
CREATE INDEX "Settlement_familyId_paidAt_idx" ON "Settlement"("familyId","paidAt");
CREATE INDEX "Settlement_payerId_paidAt_idx" ON "Settlement"("payerId","paidAt");
CREATE INDEX "Settlement_payeeId_paidAt_idx" ON "Settlement"("payeeId","paidAt");

CREATE TABLE "DocumentAccessGrant" (
  "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE RESTRICT,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "grantedById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  PRIMARY KEY ("documentId","userId"),
  CHECK ("expiresAt" IS NULL OR "expiresAt" > "createdAt"),
  CHECK (("revokedAt" IS NULL AND "revocationReason" IS NULL) OR ("revokedAt" IS NOT NULL AND char_length("revocationReason") BETWEEN 1 AND 500))
);
CREATE INDEX "DocumentAccessGrant_userId_revokedAt_expiresAt_idx" ON "DocumentAccessGrant"("userId","revokedAt","expiresAt");

CREATE TABLE "LegalCase" (
  "id" TEXT PRIMARY KEY,
  "familyId" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE RESTRICT,
  "caseReference" TEXT NOT NULL,
  "courtName" TEXT,
  "proceedingType" TEXT NOT NULL,
  "status" "LegalCaseStatus" NOT NULL DEFAULT 'ACTIVE',
  "details" TEXT,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("familyId","caseReference"),
  CHECK (char_length("caseReference") BETWEEN 1 AND 120),
  CHECK ("courtName" IS NULL OR char_length("courtName") BETWEEN 1 AND 200),
  CHECK (char_length("proceedingType") BETWEEN 1 AND 160),
  CHECK ("details" IS NULL OR char_length("details") BETWEEN 1 AND 5000)
);
CREATE INDEX "LegalCase_familyId_status_idx" ON "LegalCase"("familyId","status");

CREATE TABLE "LegalDisclosure" (
  "id" TEXT PRIMARY KEY,
  "legalCaseId" TEXT NOT NULL REFERENCES "LegalCase"("id") ON DELETE RESTRICT,
  "familyId" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE RESTRICT,
  "title" TEXT NOT NULL,
  "periodFrom" TIMESTAMPTZ(3) NOT NULL,
  "periodTo" TIMESTAMPTZ(3) NOT NULL,
  "sections" TEXT[] NOT NULL,
  "recipientUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "accessExpiresAt" TIMESTAMPTZ(3) NOT NULL,
  "status" "LegalDisclosureStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revocationReason" TEXT,
  "integritySha256" TEXT,
  CHECK (char_length("title") BETWEEN 1 AND 200),
  CHECK ("periodTo" > "periodFrom"),
  CHECK ("accessExpiresAt" > "createdAt"),
  CHECK (cardinality("sections") BETWEEN 1 AND 10),
  CHECK ("integritySha256" IS NULL OR "integritySha256" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "LegalDisclosure_familyId_status_createdAt_idx" ON "LegalDisclosure"("familyId","status","createdAt");
CREATE INDEX "LegalDisclosure_recipientUserId_status_accessExpiresAt_idx" ON "LegalDisclosure"("recipientUserId","status","accessExpiresAt");

CREATE TABLE "LegalDisclosureApproval" (
  "disclosureId" TEXT NOT NULL REFERENCES "LegalDisclosure"("id") ON DELETE RESTRICT,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("disclosureId","userId")
);
CREATE INDEX "LegalDisclosureApproval_userId_approvedAt_idx" ON "LegalDisclosureApproval"("userId","approvedAt");

CREATE TABLE "LegalDisclosureDocument" (
  "disclosureId" TEXT NOT NULL REFERENCES "LegalDisclosure"("id") ON DELETE RESTRICT,
  "documentId" TEXT NOT NULL REFERENCES "Document"("id") ON DELETE RESTRICT,
  PRIMARY KEY ("disclosureId","documentId")
);
CREATE INDEX "LegalDisclosureDocument_documentId_idx" ON "LegalDisclosureDocument"("documentId");

CREATE TABLE "NotificationEndpoint" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "channel" "NotificationEndpointChannel" NOT NULL,
  "label" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "publicKey" TEXT,
  "authSecret" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CHECK (char_length("label") BETWEEN 1 AND 100),
  CHECK (char_length("endpoint") BETWEEN 3 AND 2000),
  CHECK (("channel"='PUSH' AND "publicKey" IS NOT NULL AND "authSecret" IS NOT NULL) OR ("channel"='SMS' AND "publicKey" IS NULL AND "authSecret" IS NULL))
);
CREATE INDEX "NotificationEndpoint_userId_channel_revokedAt_idx" ON "NotificationEndpoint"("userId","channel","revokedAt");

CREATE OR REPLACE FUNCTION is_coparent_family_parent(target_family_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public."FamilyMembership" m
    WHERE m."familyId"=target_family_id AND m."userId"=public.current_coparent_user_id()
      AND m."role" IN ('OWNER'::public."FamilyRole",'PARENT'::public."FamilyRole")
      AND m."revokedAt" IS NULL AND (m."accessExpiresAt" IS NULL OR m."accessExpiresAt">timezone('UTC',statement_timestamp())))
$$;

CREATE OR REPLACE FUNCTION is_coparent_family_member(target_family_id TEXT, require_write BOOLEAN DEFAULT FALSE) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(
    SELECT 1 FROM public."FamilyMembership" membership
    WHERE membership."familyId"=target_family_id
      AND membership."userId"=public.current_coparent_user_id()
      AND membership."revokedAt" IS NULL
      AND (membership."accessExpiresAt" IS NULL OR membership."accessExpiresAt">timezone('UTC',statement_timestamp()))
      AND (
        membership."role" IN('OWNER'::public."FamilyRole",'PARENT'::public."FamilyRole")
        OR (
          NOT require_write
          AND membership."role"='PROFESSIONAL_READ_ONLY'::public."FamilyRole"
          AND NULLIF(current_setting('app.current_professional_scope',TRUE),'') IS NOT NULL
          AND NULLIF(current_setting('app.current_professional_scope',TRUE),'')::public."ProfessionalScope"=ANY(membership."professionalScopes")
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION can_view_coparent_document(target_document_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT 1 FROM public."Document" d WHERE d."id"=target_document_id AND (
    public.is_coparent_family_parent(d."familyId")
    OR (d."visibility"='FAMILY' AND public.is_coparent_family_member(d."familyId"))
    OR EXISTS(SELECT 1 FROM public."DocumentAccessGrant" g WHERE g."documentId"=d."id" AND g."userId"=public.current_coparent_user_id() AND g."revokedAt" IS NULL AND (g."expiresAt" IS NULL OR g."expiresAt">timezone('UTC',statement_timestamp())))
    OR EXISTS(SELECT 1 FROM public."LegalDisclosureDocument" ldd JOIN public."LegalDisclosure" ld ON ld."id"=ldd."disclosureId" WHERE ldd."documentId"=d."id" AND ld."recipientUserId"=public.current_coparent_user_id() AND ld."status"='APPROVED' AND ld."accessExpiresAt">timezone('UTC',statement_timestamp()))
  ))
$$;

ALTER TABLE "Settlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentAccessGrant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalCase" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalDisclosure" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalDisclosureApproval" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegalDisclosureDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationEndpoint" ENABLE ROW LEVEL SECURITY;
CREATE POLICY settlement_select ON "Settlement" FOR SELECT TO coparent_runtime USING(is_coparent_family_parent("familyId"));
CREATE POLICY document_grant_select ON "DocumentAccessGrant" FOR SELECT TO coparent_runtime USING("userId"=current_coparent_user_id() OR EXISTS(SELECT 1 FROM "Document" d WHERE d."id"="documentId" AND is_coparent_family_parent(d."familyId")));
CREATE POLICY legal_case_select ON "LegalCase" FOR SELECT TO coparent_runtime USING(is_coparent_family_parent("familyId") OR EXISTS(SELECT 1 FROM "LegalDisclosure" d WHERE d."legalCaseId"="id" AND d."recipientUserId"=current_coparent_user_id() AND d."status"='APPROVED' AND d."accessExpiresAt">timezone('UTC',statement_timestamp())));
CREATE POLICY legal_disclosure_select ON "LegalDisclosure" FOR SELECT TO coparent_runtime USING(is_coparent_family_parent("familyId") OR ("recipientUserId"=current_coparent_user_id() AND "status"='APPROVED' AND "accessExpiresAt">timezone('UTC',statement_timestamp())));
CREATE POLICY legal_approval_select ON "LegalDisclosureApproval" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "LegalDisclosure" d WHERE d."id"="disclosureId" AND (is_coparent_family_parent(d."familyId") OR d."recipientUserId"=current_coparent_user_id())));
CREATE POLICY legal_document_select ON "LegalDisclosureDocument" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "LegalDisclosure" d WHERE d."id"="disclosureId" AND (is_coparent_family_parent(d."familyId") OR (d."recipientUserId"=current_coparent_user_id() AND d."status"='APPROVED' AND d."accessExpiresAt">timezone('UTC',statement_timestamp())))));
CREATE POLICY notification_endpoint_select ON "NotificationEndpoint" FOR SELECT TO coparent_runtime USING("userId"=current_coparent_user_id());

DROP POLICY document_select ON "Document";
DROP POLICY document_version_select ON "DocumentVersion";
DROP POLICY document_child_select ON "DocumentChild";
CREATE POLICY document_select ON "Document" FOR SELECT TO coparent_runtime USING(can_view_coparent_document("id"));
CREATE POLICY document_version_select ON "DocumentVersion" FOR SELECT TO coparent_runtime USING(can_view_coparent_document("documentId"));
CREATE POLICY document_child_select ON "DocumentChild" FOR SELECT TO coparent_runtime USING(can_view_coparent_document("documentId"));

CREATE FUNCTION prevent_coparent_immutable_record_change() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'This record is immutable'; END; $$;
CREATE TRIGGER settlement_immutable BEFORE UPDATE OR DELETE ON "Settlement" FOR EACH ROW EXECUTE FUNCTION prevent_coparent_immutable_record_change();
CREATE TRIGGER legal_approval_immutable BEFORE UPDATE OR DELETE ON "LegalDisclosureApproval" FOR EACH ROW EXECUTE FUNCTION prevent_coparent_immutable_record_change();
CREATE TRIGGER legal_document_immutable BEFORE UPDATE OR DELETE ON "LegalDisclosureDocument" FOR EACH ROW EXECUTE FUNCTION prevent_coparent_immutable_record_change();

CREATE FUNCTION create_coparent_settlement(target_id TEXT,target_family TEXT,target_payer TEXT,target_payee TEXT,target_amount INTEGER,target_paid_at TIMESTAMPTZ,target_method TEXT,target_reference TEXT,target_note TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_parent(target_family) OR target_payer=target_payee OR target_amount NOT BETWEEN 1 AND 100000000 OR target_paid_at>statement_timestamp()+interval '5 minutes' OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family AND "userId"=target_payer AND "role" IN('OWNER','PARENT')) OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family AND "userId"=target_payee AND "role" IN('OWNER','PARENT')) THEN RETURN NULL; END IF;
  INSERT INTO public."Settlement"("id","familyId","payerId","payeeId","amountMinor","paidAt","method","reference","note","recordedById","createdAt") VALUES(target_id,target_family,target_payer,target_payee,target_amount,target_paid_at,target_method::public."SettlementMethod",nullif(btrim(target_reference),''),nullif(btrim(target_note),''),actor,timezone('UTC',clock_timestamp()));
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'SETTLEMENT_RECORDED','Settlement',target_id,timezone('UTC',clock_timestamp()),jsonb_build_object('payerId',target_payer,'payeeId',target_payee,'amountMinor',target_amount)); RETURN target_id;
EXCEPTION WHEN invalid_text_representation OR check_violation OR unique_violation THEN RETURN NULL; END; $$;

CREATE FUNCTION create_coparent_legal_case(target_id TEXT,target_family TEXT,target_reference TEXT,target_court TEXT,target_type TEXT,target_details TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_parent(target_family) THEN RETURN NULL; END IF;
  INSERT INTO public."LegalCase"("id","familyId","caseReference","courtName","proceedingType","details","createdById","createdAt","updatedAt") VALUES(target_id,target_family,btrim(target_reference),nullif(btrim(target_court),''),btrim(target_type),nullif(btrim(target_details),''),actor,timezone('UTC',clock_timestamp()),timezone('UTC',clock_timestamp()));
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt") VALUES(gen_random_uuid()::TEXT,target_family,actor,'LEGAL_CASE_CREATED','LegalCase',target_id,timezone('UTC',clock_timestamp())); RETURN target_id;
EXCEPTION WHEN check_violation OR unique_violation THEN RETURN NULL; END; $$;

CREATE FUNCTION create_coparent_legal_disclosure(target_id TEXT,target_case TEXT,target_family TEXT,target_title TEXT,target_from TIMESTAMPTZ,target_to TIMESTAMPTZ,target_sections TEXT[],target_recipient TEXT,target_expires TIMESTAMPTZ,target_documents TEXT[]) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_parent(target_family) OR NOT EXISTS(SELECT 1 FROM public."LegalCase" WHERE "id"=target_case AND "familyId"=target_family) OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family AND "userId"=target_recipient AND "role"='PROFESSIONAL_READ_ONLY' AND "revokedAt" IS NULL AND 'EVIDENCE'=ANY("professionalScopes")) OR target_to<=target_from OR target_expires<=statement_timestamp()+interval '5 minutes' OR cardinality(target_sections) NOT BETWEEN 1 AND 8 OR EXISTS(SELECT 1 FROM unnest(target_sections)s WHERE s<>ALL(ARRAY['chronology','messages','requests','agreements','calendar','expenses','documents','handovers'])) OR EXISTS(SELECT 1 FROM unnest(target_documents)d WHERE NOT EXISTS(SELECT 1 FROM public."Document" WHERE "id"=d AND "familyId"=target_family)) THEN RETURN NULL; END IF;
  INSERT INTO public."LegalDisclosure"("id","legalCaseId","familyId","title","periodFrom","periodTo","sections","recipientUserId","accessExpiresAt","createdById","createdAt") VALUES(target_id,target_case,target_family,btrim(target_title),target_from,target_to,target_sections,target_recipient,target_expires,actor,timezone('UTC',clock_timestamp()));
  INSERT INTO public."LegalDisclosureDocument" SELECT target_id,d FROM unnest(target_documents)d;
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'LEGAL_DISCLOSURE_REQUESTED','LegalDisclosure',target_id,timezone('UTC',clock_timestamp()),jsonb_build_object('recipientUserId',target_recipient,'accessExpiresAt',target_expires)); RETURN target_id;
EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation THEN RETURN NULL; END; $$;

CREATE FUNCTION approve_coparent_legal_disclosure(target_id TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); family_id TEXT; required_count INTEGER; approval_count INTEGER; BEGIN
  SELECT "familyId" INTO family_id FROM public."LegalDisclosure" WHERE "id"=target_id AND "status"='AWAITING_APPROVAL';
  IF family_id IS NULL OR NOT public.is_coparent_family_parent(family_id) THEN RETURN NULL; END IF;
  INSERT INTO public."LegalDisclosureApproval"("disclosureId","userId","approvedAt") VALUES(target_id,actor,timezone('UTC',clock_timestamp())) ON CONFLICT DO NOTHING;
  SELECT count(*) INTO required_count FROM public."FamilyMembership" WHERE "familyId"=family_id AND "role" IN('OWNER','PARENT') AND "revokedAt" IS NULL;
  SELECT count(*) INTO approval_count FROM public."LegalDisclosureApproval" WHERE "disclosureId"=target_id;
  IF approval_count>=required_count THEN UPDATE public."LegalDisclosure" SET "status"='APPROVED',"approvedAt"=timezone('UTC',clock_timestamp()) WHERE "id"=target_id; END IF;
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt") VALUES(gen_random_uuid()::TEXT,family_id,actor,'LEGAL_DISCLOSURE_APPROVED','LegalDisclosure',target_id,timezone('UTC',clock_timestamp())); RETURN target_id;
END; $$;

CREATE FUNCTION revoke_coparent_legal_disclosure(target_id TEXT,target_reason TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); family_id TEXT; BEGIN
  SELECT "familyId" INTO family_id FROM public."LegalDisclosure" WHERE "id"=target_id AND "status" IN('AWAITING_APPROVAL','APPROVED');
  IF family_id IS NULL OR NOT public.is_coparent_family_parent(family_id) OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500 THEN RETURN NULL; END IF;
  UPDATE public."LegalDisclosure" SET "status"='REVOKED',"revokedAt"=timezone('UTC',clock_timestamp()),"revocationReason"=btrim(target_reason) WHERE "id"=target_id;
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,family_id,actor,'LEGAL_DISCLOSURE_REVOKED','LegalDisclosure',target_id,timezone('UTC',clock_timestamp()),jsonb_build_object('reason',btrim(target_reason))); RETURN target_id;
END; $$;

CREATE FUNCTION set_coparent_document_visibility(target_document TEXT,target_family TEXT,target_visibility TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN IF actor IS NULL OR NOT public.is_coparent_family_parent(target_family) THEN RETURN NULL; END IF; UPDATE public."Document" SET "visibility"=target_visibility::public."DocumentVisibility" WHERE "id"=target_document AND "familyId"=target_family; IF NOT FOUND THEN RETURN NULL; END IF; INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'DOCUMENT_VISIBILITY_CHANGED','Document',target_document,timezone('UTC',clock_timestamp()),jsonb_build_object('visibility',target_visibility)); RETURN target_document; EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END; $$;
CREATE FUNCTION grant_coparent_document_access(target_document TEXT,target_family TEXT,target_user TEXT,target_expires TIMESTAMPTZ) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN IF actor IS NULL OR NOT public.is_coparent_family_parent(target_family) OR NOT EXISTS(SELECT 1 FROM public."Document" WHERE "id"=target_document AND "familyId"=target_family) OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family AND "userId"=target_user AND "role"='PROFESSIONAL_READ_ONLY' AND "revokedAt" IS NULL) OR target_expires<=statement_timestamp()+interval '5 minutes' THEN RETURN NULL; END IF; INSERT INTO public."DocumentAccessGrant"("documentId","userId","grantedById","createdAt","expiresAt") VALUES(target_document,target_user,actor,timezone('UTC',clock_timestamp()),target_expires) ON CONFLICT("documentId","userId") DO UPDATE SET "grantedById"=actor,"createdAt"=timezone('UTC',clock_timestamp()),"expiresAt"=target_expires,"revokedAt"=NULL,"revocationReason"=NULL; INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'DOCUMENT_ACCESS_GRANTED','Document',target_document,timezone('UTC',clock_timestamp()),jsonb_build_object('recipientUserId',target_user,'expiresAt',target_expires)); RETURN target_user; END; $$;
CREATE FUNCTION revoke_coparent_document_access(target_document TEXT,target_family TEXT,target_user TEXT,target_reason TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN IF actor IS NULL OR NOT public.is_coparent_family_parent(target_family) OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500 THEN RETURN NULL; END IF; UPDATE public."DocumentAccessGrant" SET "revokedAt"=timezone('UTC',clock_timestamp()),"revocationReason"=btrim(target_reason) WHERE "documentId"=target_document AND "userId"=target_user AND "revokedAt" IS NULL; IF NOT FOUND THEN RETURN NULL; END IF; INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'DOCUMENT_ACCESS_REVOKED','Document',target_document,timezone('UTC',clock_timestamp()),jsonb_build_object('recipientUserId',target_user,'reason',btrim(target_reason))); RETURN target_user; END; $$;

CREATE FUNCTION configure_coparent_professional_access_v2(target_family TEXT,target_user TEXT,target_expires TIMESTAMPTZ,target_type TEXT,target_scopes TEXT[]) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); changed TEXT; BEGIN IF actor IS NULL OR NOT public.is_coparent_family_owner(target_family) OR target_expires IS NOT NULL AND target_expires<=statement_timestamp()+interval '5 minutes' OR cardinality(target_scopes)<1 THEN RETURN NULL; END IF; PERFORM set_config('app.professional_access_transition_user_id',target_user,TRUE); UPDATE public."FamilyMembership" SET "accessExpiresAt"=target_expires,"professionalType"=target_type::public."ProfessionalType","professionalScopes"=ARRAY(SELECT scope::public."ProfessionalScope" FROM unnest(target_scopes) scope) WHERE "familyId"=target_family AND "userId"=target_user AND "role"='PROFESSIONAL_READ_ONLY' AND "revokedAt" IS NULL RETURNING "userId" INTO changed; PERFORM set_config('app.professional_access_transition_user_id','',TRUE); IF changed IS NULL THEN RETURN NULL; END IF; INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'PROFESSIONAL_ACCESS_CONFIGURED','FamilyMembership',target_user,timezone('UTC',clock_timestamp()),jsonb_build_object('professionalType',target_type,'scopes',target_scopes,'accessExpiresAt',target_expires)); RETURN changed; EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END; $$;

CREATE FUNCTION set_coparent_notification_channels(target_type TEXT,target_in_app BOOLEAN,target_email BOOLEAN,target_push BOOLEAN,target_sms BOOLEAN,target_lead INTEGER) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN IF actor IS NULL OR target_lead NOT BETWEEN 1 AND 168 THEN RETURN FALSE; END IF; INSERT INTO public."NotificationPreference"("userId","type","inAppEnabled","emailEnabled","pushEnabled","smsEnabled","reminderLeadHours","updatedAt") VALUES(actor,target_type::public."NotificationType",target_in_app,target_email,target_push,target_sms,target_lead,timezone('UTC',clock_timestamp())) ON CONFLICT("userId","type") DO UPDATE SET "inAppEnabled"=EXCLUDED."inAppEnabled","emailEnabled"=EXCLUDED."emailEnabled","pushEnabled"=EXCLUDED."pushEnabled","smsEnabled"=EXCLUDED."smsEnabled","reminderLeadHours"=EXCLUDED."reminderLeadHours","updatedAt"=EXCLUDED."updatedAt"; RETURN TRUE; EXCEPTION WHEN invalid_text_representation THEN RETURN FALSE; END; $$;
CREATE FUNCTION register_coparent_notification_endpoint(target_id TEXT,target_channel TEXT,target_label TEXT,target_endpoint TEXT,target_public_key TEXT,target_auth TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN IF actor IS NULL THEN RETURN NULL; END IF; INSERT INTO public."NotificationEndpoint"("id","userId","channel","label","endpoint","publicKey","authSecret","verifiedAt","createdAt") VALUES(target_id,actor,target_channel::public."NotificationEndpointChannel",btrim(target_label),target_endpoint,target_public_key,target_auth,CASE WHEN target_channel='PUSH' THEN timezone('UTC',clock_timestamp()) ELSE NULL END,timezone('UTC',clock_timestamp())); RETURN target_id; EXCEPTION WHEN invalid_text_representation OR check_violation THEN RETURN NULL; END; $$;
CREATE FUNCTION revoke_coparent_notification_endpoint(target_id TEXT) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN UPDATE public."NotificationEndpoint" SET "revokedAt"=timezone('UTC',clock_timestamp()) WHERE "id"=target_id AND "userId"=actor AND "revokedAt" IS NULL; IF NOT FOUND THEN RETURN NULL; END IF; RETURN target_id; END; $$;

REVOKE ALL ON FUNCTION is_coparent_family_member(TEXT,BOOLEAN),is_coparent_family_parent(TEXT),can_view_coparent_document(TEXT),create_coparent_settlement(TEXT,TEXT,TEXT,TEXT,INTEGER,TIMESTAMPTZ,TEXT,TEXT,TEXT),create_coparent_legal_case(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),create_coparent_legal_disclosure(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT[],TEXT,TIMESTAMPTZ,TEXT[]),approve_coparent_legal_disclosure(TEXT),revoke_coparent_legal_disclosure(TEXT,TEXT),set_coparent_document_visibility(TEXT,TEXT,TEXT),grant_coparent_document_access(TEXT,TEXT,TEXT,TIMESTAMPTZ),revoke_coparent_document_access(TEXT,TEXT,TEXT,TEXT),configure_coparent_professional_access_v2(TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT[]),set_coparent_notification_channels(TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER),register_coparent_notification_endpoint(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),revoke_coparent_notification_endpoint(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_coparent_family_member(TEXT,BOOLEAN),is_coparent_family_parent(TEXT),can_view_coparent_document(TEXT),create_coparent_settlement(TEXT,TEXT,TEXT,TEXT,INTEGER,TIMESTAMPTZ,TEXT,TEXT,TEXT),create_coparent_legal_case(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),create_coparent_legal_disclosure(TEXT,TEXT,TEXT,TEXT,TIMESTAMPTZ,TIMESTAMPTZ,TEXT[],TEXT,TIMESTAMPTZ,TEXT[]),approve_coparent_legal_disclosure(TEXT),revoke_coparent_legal_disclosure(TEXT,TEXT),set_coparent_document_visibility(TEXT,TEXT,TEXT),grant_coparent_document_access(TEXT,TEXT,TEXT,TIMESTAMPTZ),revoke_coparent_document_access(TEXT,TEXT,TEXT,TEXT),configure_coparent_professional_access_v2(TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT[]),set_coparent_notification_channels(TEXT,BOOLEAN,BOOLEAN,BOOLEAN,BOOLEAN,INTEGER),register_coparent_notification_endpoint(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT),revoke_coparent_notification_endpoint(TEXT) TO coparent_runtime;
GRANT SELECT ON "Settlement","DocumentAccessGrant","LegalCase","LegalDisclosure","LegalDisclosureApproval","LegalDisclosureDocument","NotificationEndpoint" TO coparent_runtime;
