
-- D3: columna para no repetir el aviso de "meta alcanzada" una vez mostrado
ALTER TABLE public.perfiles
  ADD COLUMN IF NOT EXISTS meta_ahorro_avisada boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.perfiles.meta_ahorro_avisada IS 'Se pone en true la primera vez que se avisa al usuario que alcanzó su meta_ahorro. Se resetea a false automáticamente (via trigger) si el usuario cambia su meta, para que pueda volver a dispararse con el nuevo objetivo.';

-- D3: trigger que detecta cuando el saldo alcanza/supera la meta de ahorro
-- y avisa una sola vez por meta (inserta en notificaciones, con un prefijo
-- especial que el frontend detecta para mostrar un modal de felicitación
-- en vez de solo un toast/campanita). Corre para CUALQUIER camino que
-- actualice perfiles.saldo (RPC de pago, Edge Function de transferencia,
-- ajuste manual del admin), porque el trigger está en la tabla, no en un
-- flujo particular del cliente.
CREATE OR REPLACE FUNCTION public.avisar_meta_ahorro_alcanzada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si la meta cambió (se fijó una nueva, se quitó, etc.), resetear el
  -- aviso para que la meta nueva pueda disparar su propio mensaje.
  IF NEW.meta_ahorro IS DISTINCT FROM OLD.meta_ahorro THEN
    NEW.meta_ahorro_avisada := false;
  END IF;

  IF NEW.meta_ahorro IS NOT NULL
     AND NEW.meta_ahorro > 0
     AND NEW.saldo >= NEW.meta_ahorro
     AND NEW.meta_ahorro_avisada = false
     AND NEW.es_admin = false THEN
    INSERT INTO public.notificaciones (usuario_id, mensaje, leida)
    VALUES (
      NEW.id,
      '🎉 META_AHORRO: ¡Felicidades, ya tienes la cantidad que deseabas! ¿Quieres contarnos qué vas a hacer con ella?',
      false
    );
    NEW.meta_ahorro_avisada := true;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_avisar_meta_ahorro ON public.perfiles;
CREATE TRIGGER trg_avisar_meta_ahorro
  BEFORE UPDATE OF saldo, meta_ahorro ON public.perfiles
  FOR EACH ROW
  EXECUTE FUNCTION public.avisar_meta_ahorro_alcanzada();

-- A1: función que el admin llama desde el cliente (via supabaseClient.rpc)
-- para pagar salario/bono. SECURITY DEFINER para poder escribir en
-- transacciones/perfiles/notificaciones de OTROS usuarios (un admin normal
-- no puede hacerlo directo por RLS), pero valida adentro que quien llama
-- es realmente admin. A diferencia de los INSERTs directos del cliente que
-- había antes: 1) SÍ actualiza perfiles.saldo, 2) calcula saldo_antes/
-- saldo_despues reales (no hardcodeados en 0/monto), 3) inserta la
-- notificación con el motivo, todo en una sola transacción por
-- destinatario (si algo falla a mitad de un destinatario, ese destinatario
-- queda sin aplicar pero no rompe a los demás porque el error solo aborta
-- el UPDATE/INSERT de esa vuelta del loop... en Postgres una excepción sí
-- aborta toda la función/transacción, así que en la práctica es todo o
-- nada por llamada; queda como deuda técnica si en el futuro se quiere
-- "mejor esfuerzo" en vez de atomicidad total).
CREATE OR REPLACE FUNCTION public.admin_pagar_saldo(
  p_destinatarios uuid[],
  p_monto numeric,
  p_motivo text,
  p_tipo text
)
RETURNS TABLE(usuario_id uuid, nombre text, nuevo_saldo numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

    INSERT INTO notificaciones (usuario_id, mensaje, leida)
    VALUES (v_id, v_mensaje_notif, false);

    RETURN QUERY SELECT p.id, p.nombre, p.saldo FROM perfiles p WHERE p.id = v_id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_pagar_saldo(uuid[], numeric, text, text) TO authenticated;

-- D2: tabla de sugerencias/quejas del buzón de la sección Bonos.
CREATE TABLE IF NOT EXISTS public.sugerencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.perfiles(id),
  mensaje text NOT NULL,
  leida boolean NOT NULL DEFAULT false,
  creado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sugerencias IS 'Buzón de sugerencias/críticas que las trabajadoras mandan desde la sección Bonos. El admin las ve todas; cada trabajadora solo ve las suyas.';

ALTER TABLE public.sugerencias ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sugerencias_select" ON public.sugerencias;
CREATE POLICY "sugerencias_select" ON public.sugerencias
  FOR SELECT
  USING (
    auth.uid() = usuario_id
    OR EXISTS (SELECT 1 FROM public.perfiles WHERE id = auth.uid() AND es_admin = true)
  );

DROP POLICY IF EXISTS "sugerencias_insert" ON public.sugerencias;
CREATE POLICY "sugerencias_insert" ON public.sugerencias
  FOR INSERT
  WITH CHECK (auth.uid() = usuario_id);

DROP POLICY IF EXISTS "sugerencias_update_admin" ON public.sugerencias;
CREATE POLICY "sugerencias_update_admin" ON public.sugerencias
  FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.perfiles WHERE id = auth.uid() AND es_admin = true));
