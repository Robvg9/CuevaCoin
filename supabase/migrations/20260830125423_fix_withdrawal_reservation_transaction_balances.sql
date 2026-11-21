CREATE OR REPLACE FUNCTION public.solicitar_retiro(p_cantidad numeric, p_idempotency_key text, p_motivo text)
RETURNS TABLE(solicitud_id uuid, nuevo_saldo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  u uuid := auth.uid();
  s numeric;
  est text;
  adm boolean;
  sid uuid;
  eu uuid;
  ec numeric;
  em text;
  ee text;
  k text := NULLIF(trim(p_idempotency_key), '');
  sb numeric;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN RAISE EXCEPTION 'Monto inválido'; END IF;

  SELECT saldo, estado, es_admin
    INTO s, est, adm
  FROM public.perfiles
  WHERE id = u
  FOR UPDATE;

  IF s IS NULL THEN RAISE EXCEPTION 'Perfil no encontrado'; END IF;
  IF adm THEN RAISE EXCEPTION 'Un admin no solicita retiros'; END IF;
  IF est IS DISTINCT FROM 'activo' THEN RAISE EXCEPTION 'Tu cuenta está desactivada'; END IF;

  IF k IS NOT NULL THEN
    SELECT id, usuario_id, cantidad, motivo, estado
      INTO sid, eu, ec, em, ee
    FROM public.solicitudes_retiro
    WHERE idempotency_key = k
    LIMIT 1;

    IF sid IS NOT NULL THEN
      IF eu <> u
         OR ec IS DISTINCT FROM p_cantidad
         OR COALESCE(em, '') IS DISTINCT FROM COALESCE(p_motivo, '') THEN
        RAISE EXCEPTION 'idempotency_key_conflict';
      END IF;

      IF ee = 'pendiente' THEN
        RETURN QUERY SELECT sid, s;
        RETURN;
      END IF;

      RAISE EXCEPTION 'idempotency_key_replay';
    END IF;
  END IF;

  SELECT id
    INTO sid
  FROM public.solicitudes_retiro
  WHERE usuario_id = u
    AND estado = 'pendiente'
  ORDER BY creado_en DESC
  LIMIT 1;

  IF sid IS NOT NULL THEN
    IF k IS NULL THEN
      RETURN QUERY SELECT sid, s;
      RETURN;
    END IF;
    RAISE EXCEPTION 'retiro_pendiente_existente';
  END IF;

  IF p_cantidad > s THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  sb := s;

  INSERT INTO public.solicitudes_retiro
    (usuario_id, cantidad, motivo, estado, idempotency_key)
  VALUES
    (u, p_cantidad, p_motivo, 'pendiente', k)
  RETURNING id INTO sid;

  UPDATE public.perfiles
  SET saldo = saldo - p_cantidad
  WHERE id = u
  RETURNING saldo INTO s;

  INSERT INTO public.transacciones
    (usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
  VALUES
    (u, NULL, 'retiro', -p_cantidad, sb, s,
     'Reserva de retiro pendiente — solicitud ' || sid::text);

  RETURN QUERY SELECT sid, s;
END;
$function$;