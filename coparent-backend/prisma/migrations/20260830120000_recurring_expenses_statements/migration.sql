CREATE TYPE "RecurringExpenseFrequency" AS ENUM ('WEEKLY','MONTHLY','TERMLY','ANNUAL');
CREATE TABLE "RecurringExpense" (
  "id" TEXT PRIMARY KEY,"familyId" TEXT NOT NULL,"createdById" TEXT NOT NULL,
  "category" "ExpenseCategory" NOT NULL,"title" TEXT NOT NULL,"description" TEXT,
  "amountMinor" INTEGER NOT NULL,"currency" TEXT NOT NULL DEFAULT 'GBP',
  "frequency" "RecurringExpenseFrequency" NOT NULL,"startDate" DATE NOT NULL,
  "endDate" DATE,"paidById" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),"cancelReason" TEXT,
  FOREIGN KEY("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("paidById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK("amountMinor" BETWEEN 1 AND 100000000),CHECK("currency"='GBP'),
  CHECK(char_length("title") BETWEEN 1 AND 160),
  CHECK("description" IS NULL OR char_length("description") BETWEEN 1 AND 5000),
  CHECK("endDate" IS NULL OR "endDate">="startDate"),
  CHECK(("cancelledAt" IS NULL AND "cancelReason" IS NULL) OR ("cancelledAt" IS NOT NULL AND char_length("cancelReason") BETWEEN 1 AND 500))
);
CREATE TABLE "RecurringExpenseAllocation"(
  "recurringExpenseId" TEXT NOT NULL,"userId" TEXT NOT NULL,"basisPoints" INTEGER NOT NULL,
  PRIMARY KEY("recurringExpenseId","userId"),
  FOREIGN KEY("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK("basisPoints" BETWEEN 0 AND 10000)
);
CREATE TABLE "RecurringExpenseChild"(
  "recurringExpenseId" TEXT NOT NULL,"childId" TEXT NOT NULL,
  PRIMARY KEY("recurringExpenseId","childId"),
  FOREIGN KEY("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "MonthlyExpenseStatement"(
  "id" TEXT PRIMARY KEY,"familyId" TEXT NOT NULL,"periodStart" DATE NOT NULL,"periodEnd" DATE NOT NULL,
  "createdById" TEXT NOT NULL,"expectedTotalMinor" INTEGER NOT NULL,"actualPaidTotalMinor" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("familyId","periodStart"),
  FOREIGN KEY("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK("periodEnd">"periodStart"),CHECK("expectedTotalMinor">=0),CHECK("actualPaidTotalMinor">=0)
);
CREATE INDEX "RecurringExpense_familyId_startDate_idx" ON "RecurringExpense"("familyId","startDate");
CREATE INDEX "RecurringExpenseAllocation_userId_idx" ON "RecurringExpenseAllocation"("userId");
CREATE INDEX "RecurringExpenseChild_childId_idx" ON "RecurringExpenseChild"("childId");
CREATE INDEX "MonthlyExpenseStatement_familyId_createdAt_idx" ON "MonthlyExpenseStatement"("familyId","createdAt");
ALTER TABLE "RecurringExpense" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringExpenseAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RecurringExpenseChild" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonthlyExpenseStatement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_expense_select ON "RecurringExpense" FOR SELECT TO coparent_runtime USING(is_coparent_family_member("familyId"));
CREATE POLICY recurring_allocation_select ON "RecurringExpenseAllocation" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "RecurringExpense" r WHERE r."id"="recurringExpenseId" AND is_coparent_family_member(r."familyId")));
CREATE POLICY recurring_child_select ON "RecurringExpenseChild" FOR SELECT TO coparent_runtime USING(EXISTS(SELECT 1 FROM "RecurringExpense" r WHERE r."id"="recurringExpenseId" AND is_coparent_family_member(r."familyId")));
CREATE POLICY statement_select ON "MonthlyExpenseStatement" FOR SELECT TO coparent_runtime USING(is_coparent_family_member("familyId"));

CREATE FUNCTION protect_recurring_expense() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recurring expense records are permanent'; END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."familyId" IS DISTINCT FROM OLD."familyId" OR NEW."createdById" IS DISTINCT FROM OLD."createdById" OR NEW."category" IS DISTINCT FROM OLD."category" OR NEW."title" IS DISTINCT FROM OLD."title" OR NEW."description" IS DISTINCT FROM OLD."description" OR NEW."amountMinor" IS DISTINCT FROM OLD."amountMinor" OR NEW."currency" IS DISTINCT FROM OLD."currency" OR NEW."frequency" IS DISTINCT FROM OLD."frequency" OR NEW."startDate" IS DISTINCT FROM OLD."startDate" OR NEW."endDate" IS DISTINCT FROM OLD."endDate" OR NEW."paidById" IS DISTINCT FROM OLD."paidById" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN RAISE EXCEPTION 'Recurring expense content is immutable'; END IF;
  IF (NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" OR NEW."cancelReason" IS DISTINCT FROM OLD."cancelReason") AND nullif(current_setting('app.recurring_expense_transition_id',TRUE),'') IS DISTINCT FROM OLD."id" THEN RAISE EXCEPTION 'Recurring expenses may be ended only through a transition function'; END IF; RETURN NEW; END; $$;
CREATE FUNCTION prevent_recurring_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Recurring expense history is immutable'; END; $$;
CREATE TRIGGER recurring_expense_protected BEFORE UPDATE OR DELETE ON "RecurringExpense" FOR EACH ROW EXECUTE FUNCTION protect_recurring_expense();
CREATE TRIGGER recurring_allocation_immutable BEFORE UPDATE OR DELETE ON "RecurringExpenseAllocation" FOR EACH ROW EXECUTE FUNCTION prevent_recurring_history_mutation();
CREATE TRIGGER recurring_child_immutable BEFORE UPDATE OR DELETE ON "RecurringExpenseChild" FOR EACH ROW EXECUTE FUNCTION prevent_recurring_history_mutation();
CREATE TRIGGER statement_immutable BEFORE UPDATE OR DELETE ON "MonthlyExpenseStatement" FOR EACH ROW EXECUTE FUNCTION prevent_recurring_history_mutation();

CREATE FUNCTION create_coparent_recurring_expense(target_id TEXT,target_family TEXT,target_category TEXT,target_title TEXT,target_description TEXT,target_amount INTEGER,target_frequency TEXT,target_start DATE,target_end DATE,target_paid_by TEXT,target_users TEXT[],target_shares INTEGER[],target_children TEXT[]) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$
DECLARE actor TEXT:=public.current_coparent_user_id();
BEGIN IF actor IS NULL OR NOT public.is_coparent_family_member(target_family,TRUE) OR target_amount NOT BETWEEN 1 AND 100000000 OR char_length(btrim(target_title)) NOT BETWEEN 1 AND 160 OR target_end IS NOT NULL AND target_end<target_start OR coalesce(array_length(target_users,1),0)<1 OR array_length(target_users,1) IS DISTINCT FROM array_length(target_shares,1) OR (SELECT sum(x) FROM unnest(target_shares)x)<>10000 OR coalesce(array_length(target_children,1),0)<1 OR NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family AND "userId"=target_paid_by AND "role" IN('OWNER','PARENT')) OR EXISTS(SELECT 1 FROM unnest(target_users)u WHERE NOT EXISTS(SELECT 1 FROM public."FamilyMembership" WHERE "familyId"=target_family AND "userId"=u AND "role" IN('OWNER','PARENT'))) OR EXISTS(SELECT 1 FROM unnest(target_children)c WHERE NOT EXISTS(SELECT 1 FROM public."Child" WHERE "id"=c AND "familyId"=target_family)) THEN RETURN NULL; END IF;
  INSERT INTO public."RecurringExpense"("id","familyId","createdById","category","title","description","amountMinor","frequency","startDate","endDate","paidById","createdAt") VALUES(target_id,target_family,actor,target_category::public."ExpenseCategory",btrim(target_title),nullif(btrim(target_description),''),target_amount,target_frequency::public."RecurringExpenseFrequency",target_start,target_end,target_paid_by,timezone('UTC',clock_timestamp()));
  INSERT INTO public."RecurringExpenseAllocation" SELECT target_id,u,s FROM unnest(target_users,target_shares)t(u,s); INSERT INTO public."RecurringExpenseChild" SELECT target_id,c FROM unnest(target_children)c;
  INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt") VALUES(gen_random_uuid()::TEXT,target_family,actor,'RECURRING_EXPENSE_CREATED','RecurringExpense',target_id,timezone('UTC',clock_timestamp())); RETURN target_id;
EXCEPTION WHEN invalid_text_representation OR unique_violation THEN RETURN NULL; END; $$;
CREATE FUNCTION cancel_coparent_recurring_expense(target_id TEXT,target_family TEXT,target_reason TEXT) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN IF actor IS NULL OR NOT public.is_coparent_family_member(target_family,TRUE) OR char_length(btrim(target_reason)) NOT BETWEEN 1 AND 500 THEN RETURN NULL; END IF; PERFORM set_config('app.recurring_expense_transition_id',target_id,TRUE); UPDATE public."RecurringExpense" SET "cancelledAt"=timezone('UTC',clock_timestamp()),"cancelReason"=btrim(target_reason) WHERE "id"=target_id AND "familyId"=target_family AND "cancelledAt" IS NULL; PERFORM set_config('app.recurring_expense_transition_id','',TRUE); IF NOT FOUND THEN RETURN NULL; END IF; INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt") VALUES(gen_random_uuid()::TEXT,target_family,actor,'RECURRING_EXPENSE_CANCELLED','RecurringExpense',target_id,timezone('UTC',clock_timestamp())); RETURN target_id; END; $$;
CREATE FUNCTION create_coparent_monthly_statement(target_id TEXT,target_family TEXT,target_start DATE,target_end DATE,target_expected INTEGER,target_actual INTEGER,target_snapshot JSONB) RETURNS TEXT LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=pg_catalog SET timezone='UTC' AS $$ DECLARE actor TEXT:=public.current_coparent_user_id(); BEGIN IF actor IS NULL OR NOT public.is_coparent_family_member(target_family,TRUE) OR target_start<>date_trunc('month',target_start)::DATE OR target_end<>(target_start+interval '1 month')::DATE OR target_expected<0 OR target_actual<0 OR jsonb_typeof(target_snapshot)<>'object' THEN RETURN NULL; END IF; INSERT INTO public."MonthlyExpenseStatement" VALUES(target_id,target_family,target_start,target_end,actor,target_expected,target_actual,target_snapshot,timezone('UTC',clock_timestamp())); INSERT INTO public."AuditEvent"("id","familyId","actorId","action","entityType","entityId","occurredAt") VALUES(gen_random_uuid()::TEXT,target_family,actor,'MONTHLY_EXPENSE_STATEMENT_CREATED','MonthlyExpenseStatement',target_id,timezone('UTC',clock_timestamp())); RETURN target_id; END; $$;
REVOKE ALL ON FUNCTION create_coparent_recurring_expense(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,DATE,DATE,TEXT,TEXT[],INTEGER[],TEXT[]) FROM PUBLIC; REVOKE ALL ON FUNCTION cancel_coparent_recurring_expense(TEXT,TEXT,TEXT) FROM PUBLIC; REVOKE ALL ON FUNCTION create_coparent_monthly_statement(TEXT,TEXT,DATE,DATE,INTEGER,INTEGER,JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_coparent_recurring_expense(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,DATE,DATE,TEXT,TEXT[],INTEGER[],TEXT[]) TO coparent_runtime; GRANT EXECUTE ON FUNCTION cancel_coparent_recurring_expense(TEXT,TEXT,TEXT) TO coparent_runtime; GRANT EXECUTE ON FUNCTION create_coparent_monthly_statement(TEXT,TEXT,DATE,DATE,INTEGER,INTEGER,JSONB) TO coparent_runtime;
GRANT SELECT ON "RecurringExpense","RecurringExpenseAllocation","RecurringExpenseChild","MonthlyExpenseStatement" TO coparent_runtime;
