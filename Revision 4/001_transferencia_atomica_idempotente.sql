-- MIGRATION PROPOSED — NOT EXECUTED
-- CUEVACOIN: transferencia atómica + idempotencia server-side
-- NO ejecutar automáticamente.

BEGIN;

CREATE TABLE public.transferencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key uuid NOT NULL UNIQUE,
  remitente_id uuid NOT NULL REFERENCES public.perfiles(id),
  destinatario_id uuid NOT NULL REFERENCES public.perfiles(id),
  cantidad numeric(12,2) NOT NULL CHECK (cantidad > 0),
  motivo text,
  estado text NOT NULL DEFAULT 'completada'
    CHECK (estado = 'completada'),
  creado_en timestamptz NOT NULL DEFAULT now(),
  completado_en timestamptz,
  CONSTRAINT transferencias_distintos_check
    CHECK (remitente_id <> destinatario_id)
);

ALTER TABLE public.transacciones
  ADD COLUMN transferencia_id uuid
  REFERENCES public.transferencias(id);

CREATE INDEX idx_transferencias_remitente
  ON public.transferencias(remitente_id, creado_en DESC);

CREATE INDEX idx_transferencias_destinatario
  ON public.transferencias(destinatario_id, creado_en DESC);

CREATE INDEX idx_transacciones_transferencia
  ON public.transacciones(transferencia_id);

CREATE OR REPLACE FUNCTION public.registrar_transferencia(
  p_destinatario_id uuid,
  p_cantidad numeric,
  p_motivo text,
  p_idempotency_key uuid
)
RETURNS TABLE(
  transferencia_id uuid,
  remitente_id uuid,
  destinatario_id uuid,
  cantidad numeric,
  saldo_remitente numeric,
  saldo_destinatario numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.transferencias%ROWTYPE;
  v_sender public.perfiles%ROWTYPE;
  v_recipient public.perfiles%ROWTYPE;
  v_low uuid;
  v_high uuid;
  v_transfer_id uuid;
  v_saldo_sender numeric;
  v_saldo_recipient numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'Se requiere idempotency_key';
  END IF;

  IF p_destinatario_id IS NULL OR p_destinatario_id = v_uid THEN
    RAISE EXCEPTION 'Destinatario inválido';
  END IF;

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Monto inválido';
  END IF;

  SELECT *
  INTO v_existing
  FROM public.transferencias
  WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    IF v_existing.remitente_id <> v_uid THEN
      RAISE EXCEPTION 'idempotency_key_conflict';
    END IF;

    IF v_existing.destinatario_id <> p_destinatario_id
       OR v_existing.cantidad <> p_cantidad
       OR COALESCE(v_existing.motivo,'') <> COALESCE(p_motivo,'') THEN
      RAISE EXCEPTION 'idempotency_key_payload_mismatch';
    END IF;

    SELECT saldo INTO v_saldo_sender
    FROM public.perfiles WHERE id = v_uid;

    SELECT saldo INTO v_saldo_recipient
    FROM public.perfiles WHERE id = p_destinatario_id;

    RETURN QUERY
      SELECT v_existing.id, v_existing.remitente_id,
             v_existing.destinatario_id, v_existing.cantidad,
             v_saldo_sender, v_saldo_recipient;
    RETURN;
  END IF;

  IF v_uid < p_destinatario_id THEN
    v_low := v_uid;
    v_high := p_destinatario_id;
  ELSE
    v_low := p_destinatario_id;
    v_high := v_uid;
  END IF;

  SELECT * INTO v_sender
  FROM public.perfiles
  WHERE id = v_low
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta no encontrada';
  END IF;

  SELECT * INTO v_recipient
  FROM public.perfiles
  WHERE id = v_high
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cuenta no encontrada';
  END IF;

  SELECT * INTO v_sender FROM public.perfiles WHERE id = v_uid;
  SELECT * INTO v_recipient FROM public.perfiles WHERE id = p_destinatario_id;

  IF v_sender.estado IS DISTINCT FROM 'activo'
     OR v_recipient.estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'Cuenta inactiva';
  END IF;

  IF v_sender.es_admin THEN
    RAISE EXCEPTION 'Cuenta no autorizada';
  END IF;

  IF v_sender.saldo < p_cantidad THEN
    RAISE EXCEPTION 'Saldo insuficiente';
  END IF;

  INSERT INTO public.transferencias (
    idempotency_key, remitente_id, destinatario_id,
    cantidad, motivo, estado, completado_en
  )
  VALUES (
    p_idempotency_key, v_uid, p_destinatario_id,
    p_cantidad, p_motivo, 'completada', now()
  )
  RETURNING id INTO v_transfer_id;

  UPDATE public.perfiles
  SET saldo = saldo - p_cantidad
  WHERE id = v_uid
  RETURNING saldo INTO v_saldo_sender;

  UPDATE public.perfiles
  SET saldo = saldo + p_cantidad
  WHERE id = p_destinatario_id
  RETURNING saldo INTO v_saldo_recipient;

  INSERT INTO public.transacciones (
    usuario_id, contraparte_id, tipo, cantidad,
    saldo_antes, saldo_despues, motivo, transferencia_id
  )
  VALUES (
    v_uid, p_destinatario_id, 'transferencia', -p_cantidad,
    v_sender.saldo, v_saldo_sender, p_motivo, v_transfer_id
  );

  INSERT INTO public.transacciones (
    usuario_id, contraparte_id, tipo, cantidad,
    saldo_antes, saldo_despues, motivo, transferencia_id
  )
  VALUES (
    p_destinatario_id, v_uid, 'transferencia', p_cantidad,
    v_recipient.saldo, v_saldo_recipient, p_motivo, v_transfer_id
  );

  INSERT INTO public.auditoria (usuario_id, usuario_nombre, accion)
  VALUES (
    v_uid,
    v_sender.nombre,
    'Transferencia de $' ||
    trim(to_char(p_cantidad,'FM999999990.00')) ||
    ' a ' || v_recipient.nombre
  );

  INSERT INTO public.notificaciones (
    usuario_id, mensaje, leida, tipo_evento
  )
  VALUES (
    p_destinatario_id,
    'Recibiste una transferencia de $' ||
    trim(to_char(p_cantidad,'FM999999990.00')),
    false,
    'transferencia_recibida'
  );

  RETURN QUERY
    SELECT v_transfer_id, v_uid, p_destinatario_id,
           p_cantidad, v_saldo_sender, v_saldo_recipient;
END;
$function$;

REVOKE ALL ON FUNCTION
  public.registrar_transferencia(uuid,numeric,text,uuid)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION
  public.registrar_transferencia(uuid,numeric,text,uuid)
TO authenticated;

ALTER TABLE public.transferencias ENABLE ROW LEVEL SECURITY;

CREATE POLICY "usuario ve sus transferencias"
ON public.transferencias
FOR SELECT TO authenticated
USING (
  remitente_id = auth.uid()
  OR destinatario_id = auth.uid()
  OR public.es_admin()
);

COMMIT;

-- NOTA:
-- Antes de implementar, revisar columnas NOT NULL exactas de auditoria,
-- policies/grants heredados y todas las demás rutas que modifican saldo.
