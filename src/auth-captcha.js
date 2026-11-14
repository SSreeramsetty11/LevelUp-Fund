// Reusable Cloudflare Turnstile widget support. The site key is public; the
// resulting token must always be verified by the server that handles the action.
export function createAuthCaptcha({ siteKey, container, status, action, doc = document, win = window }) {
  let token = '';
  let widgetId = null;
  let loading = null;

  function reset() {
    token = '';
    if (widgetId !== null && win.turnstile) {
      try { win.turnstile.reset(widgetId); }
      catch (error) { status.textContent = 'The security check could not reset. Refresh and try again.'; }
    }
  }

  async function prepare() {
    if (!siteKey) return;
    container.hidden = false;
    if (widgetId !== null) { reset(); return; }
    if (loading) return loading;
    status.textContent = 'Loading the security check…';
    loading = (async () => {
      if (!win.turnstile) {
        await new Promise((resolve, reject) => {
          const script = doc.createElement('script');
          script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
          script.async = true;
          script.addEventListener('load', resolve, { once: true });
          script.addEventListener('error', () => { script.remove(); reject(new Error('Unable to load security check')); }, { once: true });
          doc.head.append(script);
        });
      }
      status.textContent = 'Complete the security check to continue.';
      const options = {
        sitekey: siteKey,
        callback(value) { token = value; status.textContent = ''; },
        'expired-callback'() { token = ''; status.textContent = 'The security check expired. Please complete it again.'; },
        'error-callback'() { token = ''; status.textContent = 'The security check could not load. Refresh and try again.'; }
      };
      if (action) options.action = action;
      widgetId = win.turnstile.render(container, options);
    })().catch(() => {
      status.textContent = 'The security check could not load. Check your connection and try again.';
    }).finally(() => { loading = null; });
    return loading;
  }

  function consume() {
    if (!siteKey) return { ok: true, token: undefined };
    if (!token) {
      status.textContent = 'Complete the security check before continuing.';
      return { ok: false };
    }
    const result = token;
    token = '';
    return { ok: true, token: result };
  }

  return { prepare, consume, reset };
}
