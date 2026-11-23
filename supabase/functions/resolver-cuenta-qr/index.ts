// Edge Function: resolver-cuenta-qr
// -----------------------------------------------------------------------
// Resuelve un QR a la identidad interna y datos visibles del destinatario.
// Se ejecuta en servidor porque RLS no permite leer perfiles desconocidos.
// No selecciona ni devuelve correo electrónico: el flujo de transferencia usa destinatarioId.
//
// Body esperado (JSON): { numeroCuenta: string }
// Respuesta OK: { id: string, nombre: string, apellido: string, usuario: string }
// Respuesta error: { error: string } (status != 200)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'No autenticado' }, 401)
    }
    const supabaseAuth = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser()
    if (userError || !user) {
      return jsonResponse({ error: 'No autenticado' }, 401)
    }

    const { numeroCuenta } = await req.json()
    if (!numeroCuenta || typeof numeroCuenta !== 'string' || !numeroCuenta.trim()) {
      return jsonResponse({ error: 'Código QR inválido' }, 400)
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data: caller, error: callerError } = await supabaseAdmin
      .from('perfiles')
      .select('es_admin, es_dependiente, estado')
      .eq('id', user.id)
      .maybeSingle()
    if (callerError || !caller || caller.es_admin || caller.es_dependiente !== true || caller.estado !== 'activo') {
      return jsonResponse({ error: 'cuenta_solo_fortuna' }, 403)
    }

    const { data: destinatario, error: destError } = await supabaseAdmin
      .from('perfiles')
      .select('id, nombre, apellido, numero_cuenta, usuario, estado, es_dependiente')
      .eq('numero_cuenta', numeroCuenta.trim())
      .eq('es_dependiente', true)
      .maybeSingle()
    if (destError) {
      console.error('Error buscando cuenta por QR:', destError)
      return jsonResponse({ error: 'No se pudo buscar esa cuenta' }, 500)
    }
    if (!destinatario) {
      return jsonResponse({ error: 'Ese código QR no corresponde a ninguna cuenta de CuevaCoin' }, 404)
    }
    if (destinatario.id === user.id) {
      return jsonResponse({ error: 'Ese es tu propio código QR' }, 400)
    }
    if (destinatario.estado !== 'activo') {
      return jsonResponse({ error: 'Esa cuenta no está activa' }, 400)
    }
    return jsonResponse({
      id: destinatario.id,
      nombre: destinatario.nombre || '',
      apellido: destinatario.apellido || '',
      usuario: destinatario.usuario || '',
    }, 200)
  } catch (err) {
    console.error('Error inesperado en resolver-cuenta-qr:', err)
    return jsonResponse({ error: 'Error inesperado en el servidor' }, 500)
  }
})
