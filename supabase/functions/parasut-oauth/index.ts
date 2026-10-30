/**
 * Paraşüt OAuth / bağlantı test iskeleti
 * Deploy: supabase functions deploy parasut-oauth
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   PARASUT_CLIENT_ID
 *   PARASUT_CLIENT_SECRET
 *
 * Body JSON: { action: 'status' }
 * Parola grant bu dosyada yok. İstek gövdesindeki parola okunmaz ve iletilmez.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const clientId = Deno.env.get('PARASUT_CLIENT_ID') || '';
    const clientSecret = Deno.env.get('PARASUT_CLIENT_SECRET') || '';
    const configured = !!(clientId && clientSecret);

    let body = {};
    try {
      body = await req.json();
    } catch (_) {
      body = {};
    }
    const action = body.action || 'status';

    if (action === 'status') {
      return Response.json(
        {
          ok: true,
          configured,
          message: configured
            ? 'API anahtarları ortamda tanımlı. Token alma bu fonksiyonda kapalı.'
            : 'Henüz PARASUT_CLIENT_ID / PARASUT_CLIENT_SECRET tanımlı değil. destek@parasut.com başvurusunu tamamlayın.',
        },
        { headers: cors }
      );
    }

    if (action === 'token') {
      return Response.json(
        {
          ok: false,
          reason: 'token-disabled',
          message: 'Parola ile token alma bu sürümde kapalı.',
        },
        { status: 403, headers: cors }
      );
    }

    return Response.json({ ok: false, reason: 'unknown-action' }, { status: 400, headers: cors });
  } catch (e) {
    return Response.json({ ok: false, reason: String(e?.message || e) }, { status: 500, headers: cors });
  }
});
