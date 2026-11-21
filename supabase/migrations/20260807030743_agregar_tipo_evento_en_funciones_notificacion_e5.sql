CREATE OR REPLACE FUNCTION public.admin_pagar_saldo(p_destinatarios uuid[], p_monto numeric, p_motivo text, p_tipo text)
 RETURNS TABLE(usuario_id uuid, nombre text, nuevo_saldo numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_soy_admin boolean;
  v_saldo_actual numeric;
  v_id uuid;
  v_motivo_final text;
  v_mensaje_notif text;
BEGIN
  SELECT es_admin INTO v_soy_admin FROM perfiles WHERE id = auth.uid();
  IF v_soy_admin IS NOT TRUE THEN
    RAISE EXCEPTION 'Solo un admin puede pagar saldo';
  END IF;
  IF p_monto IS NULL OR p_monto <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;
  IF p_tipo NOT IN ('salario', 'bono') THEN
    RAISE EXCEPTION 'Tipo inválido';
  END IF;
  IF p_destinatarios IS NULL OR array_length(p_destinatarios, 1) IS NULL THEN
    RAISE EXCEPTION 'No se especificaron destinatarios';
  END IF;

  v_motivo_final := CASE WHEN p_tipo = 'bono' THEN 'Bono: ' || COALESCE(p_motivo, '') ELSE COALESCE(p_motivo, '') END;

  FOREACH v_id IN ARRAY p_destinatarios LOOP
    SELECT saldo INTO v_saldo_actual FROM perfiles WHERE id = v_id AND es_admin = false FOR UPDATE;
    IF v_saldo_actual IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO transacciones (usuario_id, admin_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
    VALUES (v_id, auth.uid(), 'deposito_admin', p_monto, v_saldo_actual, v_saldo_actual + p_monto, v_motivo_final);

    UPDATE perfiles SET saldo = saldo + p_monto WHERE id = v_id;

    v_mensaje_notif := 'Admin te ha enviado $' || trim(to_char(p_monto, 'FM999999990.00'))
      || CASE WHEN p_tipo = 'bono' THEN ' de bono' ELSE ' de salario' END
      || CASE WHEN p_motivo IS NOT NULL AND p_motivo <> '' THEN ' - Motivo: ' || p_motivo ELSE '' END;

    -- E5 (v72): se agrega tipo_evento='pago_admin' al insert (antes solo
    -- viajaba a enviar-push, no se guardaba en la tabla).
    INSERT INTO notificaciones (usuario_id, mensaje, leida, tipo_evento)
    VALUES (v_id, v_mensaje_notif, false, 'pago_admin');

    RETURN QUERY SELECT p.id, p.nombre, p.saldo FROM perfiles p WHERE p.id = v_id;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.avisar_meta_ahorro_alcanzada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.meta_ahorro IS DISTINCT FROM OLD.meta_ahorro THEN
    NEW.meta_ahorro_avisada := false;
  END IF;

  IF NEW.meta_ahorro IS NOT NULL
     AND NEW.meta_ahorro > 0
     AND NEW.saldo >= NEW.meta_ahorro
     AND NEW.meta_ahorro_avisada = false
     AND NEW.es_admin = false THEN
    -- E5 (v72): se agrega tipo_evento='meta_ahorro' al insert.
    INSERT INTO public.notificaciones (usuario_id, mensaje, leida, tipo_evento)
    VALUES (
      NEW.id,
      '🎉 META_AHORRO: ¡Felicidades, ya alcanzaste tu meta de ahorro! Sigue así 🎯',
      false,
      'meta_ahorro'
    );
    NEW.meta_ahorro_avisada := true;
  END IF;

  RETURN NEW;
END;
$function$;
