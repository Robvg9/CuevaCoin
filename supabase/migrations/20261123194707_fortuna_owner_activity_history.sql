BEGIN;

-- Read-only, owner-scoped financial activity. Never returns raw audit details,
-- actor UUIDs, or rows outside the current authenticated owner's book.
CREATE OR REPLACE FUNCTION fortuna_private.fortuna_list_activity(
  p_contact_id uuid,
  p_limit integer DEFAULT 50,
  p_before_occurred_at timestamptz DEFAULT NULL,
  p_before_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $fortuna_list_activity$
DECLARE
  v_book_id uuid;
  v_response jsonb;
BEGIN
  IF p_contact_id IS NULL THEN
    RAISE EXCEPTION 'fortuna_activity_contact_invalid';
  END IF;

  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 100 THEN
    RAISE EXCEPTION 'fortuna_activity_limit_invalid';
  END IF;

  IF (p_before_occurred_at IS NULL) <> (p_before_event_id IS NULL) THEN
    RAISE EXCEPTION 'fortuna_activity_cursor_invalid';
  END IF;

  v_book_id := fortuna_private.fortuna_get_current_book_id();
  IF v_book_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'items', '[]'::jsonb,
      'has_more', false,
      'next_cursor', NULL
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM fortuna_private.financial_contacts AS c
     WHERE c.book_id = v_book_id
       AND c.id = p_contact_id
  ) THEN
    RAISE EXCEPTION 'fortuna_activity_resource_not_found';
  END IF;

  WITH activity_rows AS MATERIALIZED (
    SELECT
      e.id,
      e.event_type,
      e.currency_code,
      e.total_amount_minor,
      e.occurred_at,
      e.reversal_reason,
      (
        SELECT a.action
          FROM fortuna_private.financial_audit AS a
         WHERE a.book_id = e.book_id
           AND a.event_id = e.id
         ORDER BY a.created_at DESC, a.id DESC
         LIMIT 1
      ) AS audit_action,
      COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'obligation_id', o.id,
            'description', o.description,
            'amount_minor', pg_catalog.abs(le.signed_minor)::text,
            'entry_kind', le.entry_kind
          )
          ORDER BY le.created_at, le.id
        )
          FROM fortuna_private.financial_ledger_entries AS le
          JOIN fortuna_private.financial_obligations AS o
            ON o.book_id = le.book_id
           AND o.id = le.obligation_id
         WHERE le.book_id = e.book_id
           AND le.event_id = e.id
           AND le.contact_id = e.contact_id
           AND le.currency_code = e.currency_code
      ), '[]'::jsonb) AS ledger_entries
      FROM fortuna_private.financial_events AS e
     WHERE e.book_id = v_book_id
       AND e.contact_id = p_contact_id
       AND (
         p_before_occurred_at IS NULL
         OR (e.occurred_at, e.id) < (p_before_occurred_at, p_before_event_id)
       )
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT p_limit + 1
  ),
  page AS (
    SELECT *
      FROM activity_rows
     ORDER BY occurred_at DESC, id DESC
     LIMIT p_limit
  )
  SELECT pg_catalog.jsonb_build_object(
    'items',
    COALESCE((
      SELECT pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'event_id', p.id,
          'event_type', p.event_type,
          'currency', p.currency_code,
          'total_amount_minor', p.total_amount_minor::text,
          'occurred_at', p.occurred_at,
          'reversal_reason', p.reversal_reason,
          'audit_action', p.audit_action,
          'ledger_entries', p.ledger_entries
        )
        ORDER BY p.occurred_at DESC, p.id DESC
      )
        FROM page AS p
    ), '[]'::jsonb),
    'has_more',
    (SELECT pg_catalog.count(*) > p_limit FROM activity_rows),
    'next_cursor',
    CASE
      WHEN (SELECT pg_catalog.count(*) > p_limit FROM activity_rows) THEN (
        SELECT pg_catalog.jsonb_build_object(
          'occurred_at', p.occurred_at,
          'event_id', p.id
        )
          FROM page AS p
         ORDER BY p.occurred_at ASC, p.id ASC
         LIMIT 1
      )
      ELSE NULL
    END
  )
    INTO v_response;

  RETURN v_response;
END;
$fortuna_list_activity$;

CREATE OR REPLACE FUNCTION api.list_activity(
  p_contact_id uuid,
  p_limit integer DEFAULT 50,
  p_before_occurred_at timestamptz DEFAULT NULL,
  p_before_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = pg_catalog
AS $fortuna_api_list_activity$
  SELECT fortuna_private.fortuna_list_activity($1, $2, $3, $4);
$fortuna_api_list_activity$;

REVOKE ALL ON FUNCTION fortuna_private.fortuna_list_activity(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION fortuna_private.fortuna_list_activity(uuid, integer, timestamptz, uuid)
  TO authenticated;

REVOKE ALL ON FUNCTION api.list_activity(uuid, integer, timestamptz, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION api.list_activity(uuid, integer, timestamptz, uuid)
  TO authenticated;

COMMIT;
