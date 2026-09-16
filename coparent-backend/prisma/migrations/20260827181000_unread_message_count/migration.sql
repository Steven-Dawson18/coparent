CREATE FUNCTION count_coparent_unread_messages()
RETURNS INTEGER
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT count(*)::INTEGER
  FROM public."MessageReceipt" receipt
  JOIN public."Message" message ON message."id" = receipt."messageId"
  WHERE receipt."userId" = public.current_coparent_user_id()
    AND receipt."readAt" IS NULL
    AND public.is_coparent_family_member(message."familyId")
$$;

REVOKE ALL ON FUNCTION count_coparent_unread_messages() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION count_coparent_unread_messages() TO coparent_runtime;
