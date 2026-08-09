/**
 * Paraşüt OAuth / bağlantı test iskeleti
 * Deploy: supabase functions deploy parasut-oauth
 *
 * Secrets (Dashboard → Edge Functions → Secrets):
 *   PARASUT_CLIENT_ID
 *   PARASUT_CLIENT_SECRET
 *
 * Body JSON: { action: 'status' | 'token', companyId?, username?, password? }
 * Token isteği secrets yoksa bağlanmaz — güvenli iskelet.
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
            ? 'API anahtarları tanımlı. Firma company_id ile token alınabilir.'
            : 'Henüz PARASUT_CLIENT_ID / PARASUT_CLIENT_SECRET tanımlı değil. destek@parasut.com başvurusunu tamamlayın.',
        },
        { headers: cors }
      );
    }

    if (action === 'token') {
      if (!configured) {
        return Response.json(
          { ok: false, reason: 'secrets-missing', message: 'Önce Supabase Secrets’a client_id/secret ekleyin.' },
          { status: 400, headers: cors }
        );
      }
      const companyId = String(body.companyId || '').trim();
      if (!companyId) {
        return Response.json(
          { ok: false, reason: 'company-id-missing', message: 'parasut company_id gerekli.' },
          { status: 400, headers: cors }
        );
      }
      // Canlı token: password grant (Paraşüt destek ile onaylı kullanım)
      const username = String(body.username || Deno.env.get('PARASUT_USERNAME') || '');
      const password = String(body.password || Deno.env.get('PARASUT_PASSWORD') || '');
      if (!username || !password) {
        return Response.json(
          {
            ok: false,
            reason: 'credentials-missing',
            message: 'Token için PARASUT_USERNAME/PASSWORD secret veya istek gövdesi gerekir.',
          },
          { status: 400, headers: cors }
        );
      }

      const form = new FormData();
      form.append('grant_type', 'password');
      form.append('client_id', clientId);
      form.append('client_secret', clientSecret);
      form.append('username', username);
      form.append('password', password);
      form.append('redirect_uri', 'urn:ietf:wg:oauth:2.0:oob');

      const tokenRes = await fetch('https://api.parasut.com/oauth/token', {
        method: 'POST',
        body: form,
      });
      const tokenJson = await tokenRes.json().catch(() => ({}));
      if (!tokenRes.ok) {
        return Response.json(
          { ok: false, reason: 'token-failed', detail: tokenJson },
          { status: 502, headers: cors }
        );
      }
      return Response.json(
        {
          ok: true,
          companyId,
          expires_in: tokenJson.expires_in,
          // access_token istemciye verilmez; sadece başarı sinyali (sonraki adımda sunucuda saklanır)
          token_ok: !!tokenJson.access_token,
          message: 'Token alındı. Sonraki adım: contacts senkron Edge Function.',
        },
        { headers: cors }
      );
    }

    return Response.json({ ok: false, reason: 'unknown-action' }, { status: 400, headers: cors });
  } catch (e) {
    return Response.json({ ok: false, reason: String(e?.message || e) }, { status: 500, headers: cors });
  }
});
