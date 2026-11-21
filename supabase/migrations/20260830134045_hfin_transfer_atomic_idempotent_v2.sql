ALTER TABLE public.transferencias_idempotencia
  ADD COLUMN IF NOT EXISTS transferencia_id uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS transferencias_idempotencia_transferencia_id_uidx
  ON public.transferencias_idempotencia (transferencia_id);

ALTER TABLE public.transacciones
  ADD COLUMN IF NOT EXISTS transferencia_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transacciones_transferencia_id_fkey'
      AND conrelid = 'public.transacciones'::regclass
  ) THEN
    ALTER TABLE public.transacciones
      ADD CONSTRAINT transacciones_transferencia_id_fkey
      FOREIGN KEY (transferencia_id)
      REFERENCES public.transferencias_idempotencia (transferencia_id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS transferencias_idempotencia_emisor_idx
  ON public.transferencias_idempotencia (emisor_id);
CREATE INDEX IF NOT EXISTS transferencias_idempotencia_destinatario_idx
  ON public.transferencias_idempotencia (destinatario_id);
CREATE INDEX IF NOT EXISTS transacciones_transferencia_id_idx
  ON public.transacciones (transferencia_id);

ALTER TABLE public.transferencias_idempotencia ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transferencias_idempotencia FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.transferencias_idempotencia FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.transferir_saldo_atomica(
  p_destinatario_id uuid,
  p_cantidad numeric,
  p_motivo text DEFAULT 'Transferencia'::text,
  p_idempotency_key text DEFAULT NULL::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_emisor public.perfiles%ROWTYPE;
  v_dest public.perfiles%ROWTYPE;
  v_prev public.transferencias_idempotencia%ROWTYPE;
  v_nuevo_emisor numeric;
  v_motivo text := COALESCE(NULLIF(trim(p_motivo), ''), 'Transferencia');
  v_key text := NULLIF(trim(p_idempotency_key), '');
  v_transferencia_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad <> trunc(p_cantidad) THEN
    RAISE EXCEPTION 'La cantidad debe ser un entero mayor que 0';
  END IF;
  IF p_destinatario_id IS NULL OR p_destinatario_id = auth.uid() THEN
    RAISE EXCEPTION 'Destinatario inválido';
  END IF;
  IF v_key IS NULL THEN
    RAISE EXCEPTION 'Idempotency key requerida';
  END IF;

  -- Serializa TODAS las solicitudes que usan la misma idempotency key,
  -- incluso si vinieran de emisores distintos. Esto evita el race donde
  -- dos transacciones ven que la key todavía no existe y ambas intentan crearla.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- Primero bloqueamos las cuentas en orden determinista. Así, dos transferencias
  -- distintas desde el mismo emisor no pueden leer el mismo saldo y sobre-venderlo.
  IF auth.uid() < p_destinatario_id THEN
    SELECT * INTO v_emisor FROM public.perfiles WHERE id = auth.uid() FOR UPDATE;
    SELECT * INTO v_dest FROM public.perfiles WHERE id = p_destinatario_id FOR UPDATE;
  ELSE
    SELECT * INTO v_dest FROM public.perfiles WHERE id = p_destinatario_id FOR UPDATE;
    SELECT * INTO v_emisor FROM public.perfiles WHERE id = auth.uid() FOR UPDATE;
  END IF;

  IF v_emisor.id IS NULL THEN RAISE EXCEPTION 'No se pudo verificar tu cuenta'; END IF;
  IF v_dest.id IS NULL THEN RAISE EXCEPTION 'No existe el destinatario'; END IF;
  IF v_emisor.es_admin THEN RAISE EXCEPTION 'Un admin no realiza transferencias como trabajador'; END IF;
  IF v_emisor.estado <> 'activo' THEN RAISE EXCEPTION 'Tu cuenta no está activa'; END IF;
  IF v_dest.estado <> 'activo' THEN RAISE EXCEPTION 'El destinatario no está activo'; END IF;

  -- CRÍTICO: la comprobación de idempotencia ocurre DESPUÉS del lock del emisor
  -- y además está serializada por la key. El segundo request nunca puede debitar dos veces.
  SELECT * INTO v_prev
  FROM public.transferencias_idempotencia
  WHERE idempotency_key = v_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_prev.emisor_id <> auth.uid()
       OR v_prev.destinatario_id <> p_destinatario_id
       OR v_prev.cantidad <> p_cantidad
       OR v_prev.motivo <> v_motivo THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'nuevoSaldo', v_prev.nuevo_saldo_emisor,
      'transferenciaId', v_prev.transferencia_id,
      'idempotent', true
    );
  END IF;

  IF v_emisor.saldo < p_cantidad THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;

  v_nuevo_emisor := v_emisor.saldo - p_cantidad;
  v_transferencia_id := gen_random_uuid();

  -- Permite que únicamente las funciones financieras server-side modifiquen saldo,
  -- sin abrir esa capacidad a updates directos del cliente.
  PERFORM set_config('cuevacoin.trusted_balance_write', '1', true);

  UPDATE public.perfiles
  SET saldo = v_nuevo_emisor
  WHERE id = v_emisor.id;

  UPDATE public.perfiles
  SET saldo = saldo + p_cantidad
  WHERE id = v_dest.id;

  INSERT INTO public.transferencias_idempotencia (
    idempotency_key,
    transferencia_id,
    emisor_id,
    destinatario_id,
    cantidad,
    motivo,
    nuevo_saldo_emisor
  ) VALUES (
    v_key,
    v_transferencia_id,
    v_emisor.id,
    v_dest.id,
    p_cantidad,
    v_motivo,
    v_nuevo_emisor
  );

  INSERT INTO public.transacciones (
    usuario_id, contraparte_id, tipo, cantidad, saldo_antes, saldo_despues, motivo, transferencia_id
  ) VALUES
    (
      v_emisor.id, v_dest.id, 'transferencia', -p_cantidad,
      v_emisor.saldo, v_nuevo_emisor,
      'Transferencia a ' || COALESCE(v_dest.nombre, v_dest.usuario) || ': ' || v_motivo,
      v_transferencia_id
    ),
    (
      v_dest.id, v_emisor.id, 'transferencia', p_cantidad,
      v_dest.saldo, v_dest.saldo + p_cantidad,
      'Transferencia recibida de ' || COALESCE(v_emisor.nombre, v_emisor.usuario) || ': ' || v_motivo,
      v_transferencia_id
    );

  INSERT INTO public.auditoria (usuario_id, usuario_nombre, accion)
  VALUES (
    v_emisor.id,
    COALESCE(v_emisor.nombre, v_emisor.usuario),
    'Transferencia de $' || trim(to_char(p_cantidad, 'FM999999990.00')) ||
    ' a ' || COALESCE(v_dest.nombre, v_dest.usuario)
  );

  RETURN jsonb_build_object(
    'success', true,
    'nuevoSaldo', v_nuevo_emisor,
    'transferenciaId', v_transferencia_id,
    'idempotent', false
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.transferir_saldo_atomica(uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transferir_saldo_atomica(uuid,numeric,text,text) TO authenticated;