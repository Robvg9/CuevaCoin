import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonResponse({ error: 'No autenticado' }, 401)

    const supabase = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: userError } = await supabase.auth.getUser()
    if (userError || !user) return jsonResponse({ error: 'No autenticado' }, 401)

    const body = await req.json()
    const destinatarioId = body.destinatarioId
    const destinatarioCorreo = body.destinatarioCorreo
    const cantidad = body.cantidad
    const motivo = typeof body.motivo === 'string' ? body.motivo : 'Transferencia'
    const idempotencyKey = body.idempotencyKey ?? body.idempotency_key

    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      return jsonResponse({ error: 'La cantidad debe ser un número entero mayor que 0, sin decimales' }, 400)
    }
    if (!idempotencyKey || typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) {
      return jsonResponse({ error: 'Idempotency key requerida' }, 400)
    }

    let targetId = destinatarioId
    // Compatibility only: replay queued records from clients that predate V157 and stored recipient email.
    if (!targetId && typeof destinatarioCorreo === 'string' && destinatarioCorreo.trim()) {
      const { data, error } = await supabase
        .from('perfiles')
        .select('id')
        .ilike('correo', destinatarioCorreo.trim())
        .maybeSingle()
      if (error || !data) return jsonResponse({ error: 'No existe ninguna cuenta con ese correo electrónico' }, 400)
      targetId = data.id
    }
    if (!targetId) return jsonResponse({ error: 'Destinatario requerido' }, 400)

    const { data, error } = await supabase.rpc('transferir_saldo_atomica', {
      p_destinatario_id: targetId,
      p_cantidad: cantidad,
      p_motivo: motivo,
      p_idempotency_key: idempotencyKey.trim(),
    })

    if (error) {
      const message = error.message || 'No se pudo realizar la transferencia'
      const status = /No autenticado/i.test(message) ? 401 : /Saldo insuficiente|inválido|requerida|payload diferente|no está activa|no está activo|destinatario/i.test(message) ? 400 : 500
      return jsonResponse({ error: message }, status)
    }

    return jsonResponse(data, 200)
  } catch (err) {
    console.error('Error inesperado en transferir-saldo:', err)
    return jsonResponse({ error: 'Error inesperado en el servidor' }, 500)
  }
})
