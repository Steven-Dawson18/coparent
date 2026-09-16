CREATE TYPE "ExpenseCategory" AS ENUM ('SCHOOL','MEDICAL','ACTIVITY','CLOTHING','CHILDCARE','TRAVEL','FOOD','OTHER');
CREATE TYPE "ExpenseResponseType" AS ENUM ('ACCEPT','DECLINE','DISPUTE');

CREATE TABLE "Expense" (
  "id" TEXT PRIMARY KEY, "familyId" TEXT NOT NULL, "createdById" TEXT NOT NULL,
  "respondentId" TEXT NOT NULL, "currentVersionId" TEXT UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("respondentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("createdById" <> "respondentId")
);
CREATE TABLE "ExpenseVersion" (
  "id" TEXT PRIMARY KEY, "expenseId" TEXT NOT NULL, "revision" INTEGER NOT NULL,
  "category" "ExpenseCategory" NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "amountMinor" INTEGER NOT NULL, "currency" TEXT NOT NULL DEFAULT 'GBP',
  "incurredOn" DATE NOT NULL, "paidById" TEXT NOT NULL, "changedById" TEXT NOT NULL,
  "changeReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("expenseId","revision"),
  FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("amountMinor" BETWEEN 1 AND 100000000), CHECK ("currency"='GBP'),
  CHECK (char_length("title") BETWEEN 1 AND 160),
  CHECK ("description" IS NULL OR char_length("description") BETWEEN 1 AND 5000),
  CHECK ("changeReason" IS NULL OR char_length("changeReason") BETWEEN 1 AND 500)
);
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_currentVersionId_fkey"
  FOREIGN KEY ("currentVersionId") REFERENCES "ExpenseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ExpenseAllocation" (
  "versionId" TEXT NOT NULL, "userId" TEXT NOT NULL, "basisPoints" INTEGER NOT NULL,
  "amountMinor" INTEGER NOT NULL, PRIMARY KEY ("versionId","userId"),
  FOREIGN KEY ("versionId") REFERENCES "ExpenseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("basisPoints" BETWEEN 0 AND 10000), CHECK ("amountMinor">=0)
);
CREATE TABLE "ExpenseVersionChild" (
  "versionId" TEXT NOT NULL, "childId" TEXT NOT NULL, PRIMARY KEY ("versionId","childId"),
  FOREIGN KEY ("versionId") REFERENCES "ExpenseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "ExpenseResponse" (
  "id" TEXT PRIMARY KEY, "expenseId" TEXT NOT NULL, "versionId" TEXT NOT NULL UNIQUE,
  "responderId" TEXT NOT NULL, "type" "ExpenseResponseType" NOT NULL, "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("versionId") REFERENCES "ExpenseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY ("responderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 2000)
);
CREATE INDEX "Expense_familyId_createdAt_idx" ON "Expense"("familyId","createdAt");
CREATE INDEX "Expense_respondentId_createdAt_idx" ON "Expense"("respondentId","createdAt");
CREATE INDEX "ExpenseVersion_incurredOn_idx" ON "ExpenseVersion"("incurredOn");
CREATE INDEX "ExpenseAllocation_userId_idx" ON "ExpenseAllocation"("userId");
CREATE INDEX "ExpenseVersionChild_childId_idx" ON "ExpenseVersionChild"("childId");
CREATE INDEX "ExpenseResponse_expenseId_createdAt_idx" ON "ExpenseResponse"("expenseId","createdAt");

ALTER TABLE "Expense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseVersionChild" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ExpenseResponse" ENABLE ROW LEVEL SECURITY;
CREATE POLICY expense_select ON "Expense" FOR SELECT TO coparent_runtime USING (is_coparent_family_member("familyId"));
CREATE POLICY expense_version_select ON "ExpenseVersion" FOR SELECT TO coparent_runtime USING (EXISTS (SELECT 1 FROM "Expense" e WHERE e."id"="expenseId" AND is_coparent_family_member(e."familyId")));
CREATE POLICY expense_allocation_select ON "ExpenseAllocation" FOR SELECT TO coparent_runtime USING (EXISTS (SELECT 1 FROM "ExpenseVersion" v JOIN "Expense" e ON e."id"=v."expenseId" WHERE v."id"="versionId" AND is_coparent_family_member(e."familyId")));
CREATE POLICY expense_child_select ON "ExpenseVersionChild" FOR SELECT TO coparent_runtime USING (EXISTS (SELECT 1 FROM "ExpenseVersion" v JOIN "Expense" e ON e."id"=v."expenseId" WHERE v."id"="versionId" AND is_coparent_family_member(e."familyId")));
CREATE POLICY expense_response_select ON "ExpenseResponse" FOR SELECT TO coparent_runtime USING (EXISTS (SELECT 1 FROM "Expense" e WHERE e."id"="expenseId" AND is_coparent_family_member(e."familyId")));

CREATE FUNCTION protect_expense() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Expense records are permanent'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."familyId" IS DISTINCT FROM OLD."familyId" OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."respondentId" IS DISTINCT FROM OLD."respondentId" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'Expense identity is immutable'; END IF;
  IF NEW."currentVersionId" IS DISTINCT FROM OLD."currentVersionId" AND nullif(current_setting('app.expense_transition_id',TRUE),'') IS DISTINCT FROM OLD."id" THEN RAISE EXCEPTION 'Expense versions may change only through a transition function'; END IF;
  RETURN NEW;
END; $$;
CREATE FUNCTION prevent_expense_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Expense history is immutable'; END; $$;
CREATE TRIGGER expense_protected BEFORE UPDATE OR DELETE ON "Expense" FOR EACH ROW EXECUTE FUNCTION protect_expense();
CREATE TRIGGER expense_version_immutable BEFORE UPDATE OR DELETE ON "ExpenseVersion" FOR EACH ROW EXECUTE FUNCTION prevent_expense_history_mutation();
CREATE TRIGGER expense_allocation_immutable BEFORE UPDATE OR DELETE ON "ExpenseAllocation" FOR EACH ROW EXECUTE FUNCTION prevent_expense_history_mutation();
CREATE TRIGGER expense_child_immutable BEFORE UPDATE OR DELETE ON "ExpenseVersionChild" FOR EACH ROW EXECUTE FUNCTION prevent_expense_history_mutation();
CREATE TRIGGER expense_response_immutable BEFORE UPDATE OR DELETE ON "ExpenseResponse" FOR EACH ROW EXECUTE FUNCTION prevent_expense_history_mutation();

CREATE FUNCTION insert_coparent_expense_version(target_version_id TEXT,target_expense_id TEXT,target_revision INTEGER,target_category TEXT,target_title TEXT,target_description TEXT,target_amount INTEGER,target_date DATE,target_paid_by TEXT,target_actor TEXT,target_reason TEXT,target_user_ids TEXT[],target_basis_points INTEGER[],target_child_ids TEXT[]) RETURNS BOOLEAN
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
BEGIN
  IF target_amount NOT BETWEEN 1 AND 100000000 OR char_length(btrim(target_title)) NOT BETWEEN 1 AND 160 OR coalesce(array_length(target_user_ids,1),0)<1 OR coalesce(array_length(target_child_ids,1),0)<1 OR array_length(target_user_ids,1) IS DISTINCT FROM array_length(target_basis_points,1) OR (SELECT sum(x) FROM unnest(target_basis_points)x)<>10000 THEN RETURN FALSE; END IF;
  INSERT INTO public."ExpenseVersion"("id","expenseId","revision","category","title","description","amountMinor","incurredOn","paidById","changedById","changeReason","createdAt") VALUES(target_version_id,target_expense_id,target_revision,target_category::public."ExpenseCategory",btrim(target_title),nullif(btrim(target_description),''),target_amount,target_date,target_paid_by,target_actor,nullif(btrim(target_reason),''),timezone('UTC',clock_timestamp()));
  WITH shares AS (SELECT u,b,ord,row_number() OVER(ORDER BY ord DESC)=1 AS is_last FROM unnest(target_user_ids,target_basis_points) WITH ORDINALITY t(u,b,ord)), calculated AS (SELECT u,b,ord,is_last,CASE WHEN is_last THEN target_amount-sum(floor(target_amount*b/10000.0)::INTEGER) FILTER(WHERE NOT is_last) OVER() ELSE floor(target_amount*b/10000.0)::INTEGER END AS allocated_amount FROM shares)
  INSERT INTO public."ExpenseAllocation"("versionId","userId","basisPoints","amountMinor") SELECT target_version_id,u,b,allocated_amount FROM calculated;
  INSERT INTO public."ExpenseVersionChild" SELECT target_version_id,c FROM unnest(target_child_ids)c;
  RETURN TRUE;
EXCEPTION WHEN invalid_text_representation OR unique_violation OR foreign_key_violation THEN RETURN FALSE; END; $$;

CREATE FUNCTION create_coparent_expense(target_id TEXT,target_version_id TEXT,target_family_id TEXT,target_respondent TEXT,target_category TEXT,target_title TEXT,target_description TEXT,target_amount INTEGER,target_date DATE,target_paid_by TEXT,target_user_ids TEXT[],target_basis_points INTEGER[],target_child_ids TEXT[]) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id(); ok BOOLEAN;
BEGIN
  IF actor IS NULL OR NOT public.is_coparent_family_member(target_family_id,TRUE) OR actor=target_respondent OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family_id AND "userId"=target_respondent AND "role" IN('OWNER','PARENT')) OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family_id AND "userId"=target_paid_by AND "role" IN('OWNER','PARENT')) OR EXISTS(SELECT 1 FROM unnest(target_user_ids)u WHERE NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family_id AND "userId"=u AND "role" IN('OWNER','PARENT'))) OR EXISTS(SELECT 1 FROM unnest(target_child_ids)c WHERE NOT EXISTS(SELECT 1 FROM public."Child" WHERE "id"=c AND "familyId"=target_family_id)) THEN RETURN NULL; END IF;
  INSERT INTO public."Expense"("id","familyId","createdById","respondentId","createdAt") VALUES(target_id,target_family_id,actor,target_respondent,timezone('UTC',clock_timestamp()));
  SELECT public.insert_coparent_expense_version(target_version_id,target_id,1,target_category,target_title,target_description,target_amount,target_date,target_paid_by,actor,NULL,target_user_ids,target_basis_points,target_child_ids) INTO ok; IF NOT ok THEN RAISE EXCEPTION 'Invalid expense'; END IF;
  PERFORM set_config('app.expense_transition_id',target_id,TRUE); UPDATE public."Expense" SET "currentVersionId"=target_version_id WHERE "id"=target_id; PERFORM set_config('app.expense_transition_id','',TRUE);
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt") VALUES(gen_random_uuid()::TEXT,target_family_id,actor,'EXPENSE_PROPOSED','Expense',target_id,timezone('UTC',clock_timestamp())); RETURN target_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END; $$;

CREATE FUNCTION revise_coparent_expense(target_id TEXT,target_version_id TEXT,target_family_id TEXT,target_category TEXT,target_title TEXT,target_description TEXT,target_amount INTEGER,target_date DATE,target_paid_by TEXT,target_reason TEXT,target_user_ids TEXT[],target_basis_points INTEGER[],target_child_ids TEXT[]) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id(); current_revision INTEGER; ok BOOLEAN;
BEGIN
  SELECT v."revision" INTO current_revision FROM public."Expense" e JOIN public."ExpenseVersion" v ON v."id"=e."currentVersionId" WHERE e."id"=target_id AND e."familyId"=target_family_id AND e."createdById"=actor FOR UPDATE OF e;
  IF current_revision IS NULL OR NOT public.is_coparent_family_member(target_family_id,TRUE) OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500 OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family_id AND "userId"=target_paid_by AND "role" IN('OWNER','PARENT')) OR EXISTS(SELECT 1 FROM unnest(target_user_ids)u WHERE NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family_id AND "userId"=u AND "role" IN('OWNER','PARENT'))) OR EXISTS(SELECT 1 FROM unnest(target_child_ids)c WHERE NOT EXISTS(SELECT 1 FROM public."Child" WHERE "id"=c AND "familyId"=target_family_id)) THEN RETURN NULL; END IF;
  SELECT public.insert_coparent_expense_version(target_version_id,target_id,current_revision+1,target_category,target_title,target_description,target_amount,target_date,target_paid_by,actor,target_reason,target_user_ids,target_basis_points,target_child_ids) INTO ok; IF NOT ok THEN RAISE EXCEPTION 'Invalid expense'; END IF;
  PERFORM set_config('app.expense_transition_id',target_id,TRUE); UPDATE public."Expense" SET "currentVersionId"=target_version_id WHERE "id"=target_id; PERFORM set_config('app.expense_transition_id','',TRUE);
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt") VALUES(gen_random_uuid()::TEXT,target_family_id,actor,'EXPENSE_REVISED','Expense',target_id,timezone('UTC',clock_timestamp())); RETURN target_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END; $$;

CREATE FUNCTION respond_to_coparent_expense(target_expense_id TEXT,target_response_id TEXT,target_family_id TEXT,target_type TEXT,target_note TEXT) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id(); target_family TEXT; target_version TEXT;
BEGIN
  SELECT e."familyId",e."currentVersionId" INTO target_family,target_version FROM public."Expense" e WHERE e."id"=target_expense_id AND e."familyId"=target_family_id AND e."respondentId"=actor FOR UPDATE;
  IF target_version IS NULL OR EXISTS(SELECT 1 FROM public."ExpenseResponse" WHERE "versionId"=target_version) OR target_type NOT IN('ACCEPT','DECLINE','DISPUTE') OR target_type IN('DECLINE','DISPUTE') AND coalesce(char_length(btrim(target_note)),0)<1 THEN RETURN NULL; END IF;
  INSERT INTO public."ExpenseResponse" VALUES(target_response_id,target_expense_id,target_version,actor,target_type::public."ExpenseResponseType",nullif(btrim(target_note),''),timezone('UTC',clock_timestamp()));
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt","metadata") VALUES(gen_random_uuid()::TEXT,target_family,actor,'EXPENSE_'||target_type,'Expense',target_expense_id,timezone('UTC',clock_timestamp()),jsonb_build_object('versionId',target_version)); RETURN target_expense_id;
EXCEPTION WHEN invalid_text_representation THEN RETURN NULL; END; $$;

REVOKE ALL ON FUNCTION insert_coparent_expense_version(TEXT,TEXT,INTEGER,TEXT,TEXT,TEXT,INTEGER,DATE,TEXT,TEXT,TEXT,TEXT[],INTEGER[],TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_coparent_expense(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE,TEXT,TEXT[],INTEGER[],TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION revise_coparent_expense(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE,TEXT,TEXT,TEXT[],INTEGER[],TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION respond_to_coparent_expense(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_coparent_expense(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE,TEXT,TEXT[],INTEGER[],TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION revise_coparent_expense(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,DATE,TEXT,TEXT,TEXT[],INTEGER[],TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION respond_to_coparent_expense(TEXT,TEXT,TEXT,TEXT,TEXT) TO coparent_runtime;
GRANT SELECT ON "Expense","ExpenseVersion","ExpenseAllocation","ExpenseVersionChild","ExpenseResponse" TO coparent_runtime;
