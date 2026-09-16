CREATE TYPE "MessageCategory" AS ENUM (
  'GENERAL', 'CHILD_ARRANGEMENTS', 'SCHOOL', 'HEALTH', 'MONEY',
  'ACTIVITIES', 'HOLIDAY', 'IMPORTANT_DECISION'
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "familyId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL,
  "category" "MessageCategory" NOT NULL DEFAULT 'GENERAL',
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Message_body_length_check" CHECK (char_length("body") BETWEEN 1 AND 5000),
  CONSTRAINT "Message_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MessageChild" (
  "messageId" TEXT NOT NULL,
  "childId" TEXT NOT NULL,
  CONSTRAINT "MessageChild_pkey" PRIMARY KEY ("messageId", "childId"),
  CONSTRAINT "MessageChild_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MessageChild_childId_fkey" FOREIGN KEY ("childId") REFERENCES "Child"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MessageReceipt" (
  "messageId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deliveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "MessageReceipt_pkey" PRIMARY KEY ("messageId", "userId"),
  CONSTRAINT "MessageReceipt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "MessageReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "Message_familyId_createdAt_id_idx" ON "Message"("familyId", "createdAt", "id");
CREATE INDEX "Message_senderId_createdAt_idx" ON "Message"("senderId", "createdAt");
CREATE INDEX "MessageChild_childId_idx" ON "MessageChild"("childId");
CREATE INDEX "MessageReceipt_userId_readAt_idx" ON "MessageReceipt"("userId", "readAt");

ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageChild" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MessageReceipt" ENABLE ROW LEVEL SECURITY;

CREATE POLICY message_select ON "Message" FOR SELECT TO coparent_runtime
  USING (is_coparent_family_member("familyId"));
CREATE POLICY message_child_select ON "MessageChild" FOR SELECT TO coparent_runtime
  USING (EXISTS (
    SELECT 1 FROM "Message" message
    WHERE message."id" = "messageId"
      AND is_coparent_family_member(message."familyId")
  ));
CREATE POLICY message_receipt_select ON "MessageReceipt" FOR SELECT TO coparent_runtime
  USING (EXISTS (
    SELECT 1 FROM "Message" message
    WHERE message."id" = "messageId"
      AND is_coparent_family_member(message."familyId")
  ));

CREATE FUNCTION prevent_message_record_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sent message records are immutable';
END;
$$;

CREATE TRIGGER message_immutable
BEFORE UPDATE OR DELETE ON "Message"
FOR EACH ROW EXECUTE FUNCTION prevent_message_record_mutation();
CREATE TRIGGER message_child_immutable
BEFORE UPDATE OR DELETE ON "MessageChild"
FOR EACH ROW EXECUTE FUNCTION prevent_message_record_mutation();

CREATE FUNCTION create_coparent_message(
  target_message_id TEXT,
  target_family_id TEXT,
  target_category TEXT,
  target_body TEXT,
  target_child_ids TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  normalized_body TEXT := btrim(target_body);
  distinct_child_count INTEGER;
BEGIN
  IF actor_id IS NULL OR NOT public.is_coparent_family_member(target_family_id, TRUE) THEN
    RETURN NULL;
  END IF;
  IF normalized_body IS NULL OR char_length(normalized_body) NOT BETWEEN 1 AND 5000 THEN
    RETURN NULL;
  END IF;

  SELECT count(DISTINCT child_id) INTO distinct_child_count
  FROM unnest(target_child_ids) AS child_id;
  IF distinct_child_count <> coalesce(array_length(target_child_ids, 1), 0) OR EXISTS (
    SELECT 1 FROM unnest(target_child_ids) AS child_id
    WHERE NOT EXISTS (
      SELECT 1 FROM public."Child" child
      WHERE child."id" = child_id AND child."familyId" = target_family_id
    )
  ) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public."Message" ("id", "familyId", "senderId", "category", "body", "createdAt")
  VALUES (
    target_message_id, target_family_id, actor_id,
    target_category::public."MessageCategory", normalized_body,
    timezone('UTC', clock_timestamp())
  );

  INSERT INTO public."MessageChild" ("messageId", "childId")
  SELECT target_message_id, child_id FROM unnest(target_child_ids) AS child_id;

  INSERT INTO public."MessageReceipt" ("messageId", "userId", "deliveredAt", "readAt")
  SELECT target_message_id, membership."userId", timezone('UTC', clock_timestamp()),
    CASE WHEN membership."userId" = actor_id THEN timezone('UTC', clock_timestamp()) ELSE NULL END
  FROM public."FamilyMembership" membership
  WHERE membership."familyId" = target_family_id;

  INSERT INTO public."AuditEvent" (
    "id", "familyId", "actorId", "action", "entityType", "entityId", "occurredAt", "metadata"
  ) VALUES (
    gen_random_uuid()::TEXT, target_family_id, actor_id, 'MESSAGE_SENT', 'Message',
    target_message_id, timezone('UTC', clock_timestamp()),
    jsonb_build_object('category', target_category, 'childCount', distinct_child_count)
  );
  RETURN target_message_id;
EXCEPTION
  WHEN invalid_text_representation THEN RETURN NULL;
END;
$$;

CREATE FUNCTION mark_coparent_message_read(target_message_id TEXT, target_family_id TEXT)
RETURNS TIMESTAMP(3)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog
SET timezone = 'UTC'
AS $$
DECLARE
  actor_id TEXT := public.current_coparent_user_id();
  result TIMESTAMP(3);
BEGIN
  IF actor_id IS NULL OR NOT public.is_coparent_family_member(target_family_id) THEN
    RETURN NULL;
  END IF;
  UPDATE public."MessageReceipt" receipt SET
    "readAt" = coalesce(receipt."readAt", timezone('UTC', clock_timestamp()))
  FROM public."Message" message
  WHERE receipt."messageId" = target_message_id
    AND receipt."userId" = actor_id
    AND message."id" = receipt."messageId"
    AND message."familyId" = target_family_id
  RETURNING receipt."readAt" INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION prevent_message_record_mutation() FROM PUBLIC;
REVOKE ALL ON FUNCTION create_coparent_message(TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION mark_coparent_message_read(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_coparent_message(TEXT, TEXT, TEXT, TEXT, TEXT[]) TO coparent_runtime;
GRANT EXECUTE ON FUNCTION mark_coparent_message_read(TEXT, TEXT) TO coparent_runtime;
GRANT SELECT ON "Message", "MessageChild", "MessageReceipt" TO coparent_runtime;
