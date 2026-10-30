/**
 * Kiosk kapısı. Masaüstü ve mobil varsayılanı değiştirmez.
 * portal=kiosk değilse süre ve hatırlama eski haliyle kalır.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BtdKiosk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DESKTOP_IDLE_MS = 2 * 60 * 60 * 1000;
  const KIOSK_IDLE_MS = 5 * 60 * 1000;

  function detectPortal(search) {
    const raw = String(search || '');
    const params = new URLSearchParams(raw.charAt(0) === '?' ? raw.slice(1) : raw);
    return params.get('portal') === 'kiosk' ? 'kiosk' : 'desktop';
  }

  function idleMs(portal) {
    return portal === 'kiosk' ? KIOSK_IDLE_MS : DESKTOP_IDLE_MS;
  }

  function allowsRemember(portal) {
    return portal !== 'kiosk';
  }

  function allowsSavedPassword() {
    return false;
  }

  async function endSupabaseSession(auth) {
    if (!auth || typeof auth.signOut !== 'function') return false;
    try {
      await auth.signOut();
      return true;
    } catch (err) {
      try {
        await auth.signOut({ scope: 'local' });
        return true;
      } catch (err2) {
        return false;
      }
    }
  }

  return {
    DESKTOP_IDLE_MS,
    KIOSK_IDLE_MS,
    detectPortal,
    idleMs,
    allowsRemember,
    allowsSavedPassword,
    endSupabaseSession,
  };
});
