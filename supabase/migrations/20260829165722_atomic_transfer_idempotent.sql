CREATE TABLE IF NOT EXISTS public.transferencias_idempotencia (
  idempotency_key text PRIMARY KEY,
  emisor_id uuid NOT NULL REFERENCES public.perfiles(id),
  destinatario_id uuid NOT NULL REFERENCES public.perfiles(id),
  cantidad numeric NOT NULL CHECK (cantidad > 0),
  motivo text NOT NULL,
  nuevo_saldo_emisor numeric NOT NULL,
  creado_en timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.transferir_saldo_atomica(
  p_destinatario_id uuid,
  p_cantidad numeric,
  p_motivo text DEFAULT 'Transferencia',
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emisor public.perfiles%ROWTYPE;
  v_dest public.perfiles%ROWTYPE;
  v_prev public.transferencias_idempotencia%ROWTYPE;
  v_nuevo_emisor numeric;
  v_motivo text := COALESCE(NULLIF(trim(p_motivo), ''), 'Transferencia');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_cantidad <> trunc(p_cantidad) THEN
    RAISE EXCEPTION 'La cantidad debe ser un entero mayor que 0';
  END IF;
  IF p_destinatario_id IS NULL OR p_destinatario_id = auth.uid() THEN
    RAISE EXCEPTION 'Destinatario inválido';
  END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'Idempotency key requerida';
  END IF;

  SELECT * INTO v_prev FROM public.transferencias_idempotencia WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_prev.emisor_id <> auth.uid() OR v_prev.destinatario_id <> p_destinatario_id OR v_prev.cantidad <> p_cantidad OR v_prev.motivo <> v_motivo THEN
      RAISE EXCEPTION 'La idempotency key ya fue utilizada con un payload diferente';
    END IF;
    RETURN jsonb_build_object('success', true, 'nuevoSaldo', v_prev.nuevo_saldo_emisor, 'idempotent', true);
  END IF;

  -- Orden determinista de locks evita deadlocks entre transferencias cruzadas.
  IF auth.uid() < p_destinatario_id THEN
    SELECT * INTO v_emisor FROM public.perfiles WHERE id = auth.uid() FOR UPDATE;
    SELECT * INTO v_dest FROM public.perfiles WHERE id = p_destinatario_id FOR UPDATE;
  ELSE
    SELECT * INTO v_dest FROM public.perfiles WHERE id = p_destinatario_id FOR UPDATE;
    SELECT * INTO v_emisor FROM public.perfiles WHERE id = auth.uid() FOR UPDATE;
  END IF;

  IF v_emisor.id IS NULL THEN RAISE EXCEPTION 'No se pudo verificar tu cuenta'; END IF;
  IF v_dest.id IS NULL THEN RAISE EXCEPTION 'No existe el destinatario'; END IF;
  IF v_emisor.estado <> 'activo' THEN RAISE EXCEPTION 'Tu cuenta no está activa'; END IF;
  IF v_dest.estado <> 'activo' THEN RAISE EXCEPTION 'El destinatario no está activo'; END IF;
  IF v_emisor.saldo < p_cantidad THEN RAISE EXCEPTION 'Saldo insuficiente'; END IF;

  v_nuevo_emisor := v_emisor.saldo - p_cantidad;
  UPDATE public.perfiles SET saldo = v_nuevo_emisor WHERE id = v_emisor.id;
  UPDATE public.perfiles SET saldo = saldo + p_cantidad WHERE id = v_dest.id;

  INSERT INTO public.transacciones (usuario_id, contraparte_id, tipo, cantidad, saldo_antes, saldo_despues, motivo)
  VALUES
    (v_emisor.id, v_dest.id, 'transferencia', -p_cantidad, v_emisor.saldo, v_nuevo_emisor, 'Transferencia a ' || COALESCE(v_dest.nombre, v_dest.usuario) || ': ' || v_motivo),
    (v_dest.id, v_emisor.id, 'transferencia', p_cantidad, v_dest.saldo, v_dest.saldo + p_cantidad, 'Transferencia recibida de ' || COALESCE(v_emisor.nombre, v_emisor.usuario) || ': ' || v_motivo);

  INSERT INTO public.transferencias_idempotencia (idempotency_key, emisor_id, destinatario_id, cantidad, motivo, nuevo_saldo_emisor)
  VALUES (p_idempotency_key, v_emisor.id, v_dest.id, p_cantidad, v_motivo, v_nuevo_emisor);

  RETURN jsonb_build_object('success', true, 'nuevoSaldo', v_nuevo_emisor, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.transferir_saldo_atomica(uuid,numeric,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transferir_saldo_atomica(uuid,numeric,text,text) TO authenticated;
