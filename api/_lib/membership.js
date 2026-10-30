'use strict';

const { publicError } = require('./guard');

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 180) };
  }
}

async function resolveMembership(config, accessToken, fetchImpl) {
  const fetchFn = fetchImpl || fetch;
  let userRes;
  try {
    userRes = await fetchFn(`${config.url}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch {
    return { status: 401, error: 'oturum doğrulanamadı' };
  }
  if (userRes.status === 401 || userRes.status === 403) return { status: 401, error: 'yetkisiz' };
  if (!userRes.ok) return { status: 401, error: 'yetkisiz' };
  const user = await readJson(userRes);
  if (!user || !user.id) return { status: 401, error: 'yetkisiz' };

  let rpcRes;
  try {
    rpcRes = await fetchFn(`${config.url}/rest/v1/rpc/btd_oturum_baglami`, {
      method: 'POST',
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch {
    return { status: 403, error: 'erişim yok' };
  }
  if (!rpcRes.ok) return { status: 403, error: 'erişim yok' };
  const membership = await readJson(rpcRes);
  if (!membership || !membership.kullanici_id || !Array.isArray(membership.firmalar)) {
    return { status: 403, error: 'erişim yok' };
  }
  if (membership.sifre_hash || membership.tc_no || membership.password) {
    return { status: 403, error: 'erişim yok' };
  }
  const firmaIds = membership.firmalar.map((firm) => firm && firm.id).filter(Boolean);
  return {
    status: 200,
    actor: String(user.id),
    firmaIds,
    membership,
    error: publicError(''),
  };
}

function firmaAllowed(membership, firmaId) {
  if (!membership || membership.status !== 200) return false;
  return membership.firmaIds.indexOf(firmaId) !== -1;
}

module.exports = { resolveMembership, firmaAllowed };
