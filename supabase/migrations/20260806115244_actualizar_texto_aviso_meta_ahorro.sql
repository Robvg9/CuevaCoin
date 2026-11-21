CREATE OR REPLACE FUNCTION public.avisar_meta_ahorro_alcanzada()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      '🎉 META_AHORRO: ¡Felicidades, ya alcanzaste tu meta de ahorro! Sigue así 🎯',
      false
    );
    NEW.meta_ahorro_avisada := true;
  END IF;

  RETURN NEW;
END;
$function$
