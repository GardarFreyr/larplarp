// Sign-in / onboarding. Google is the only provider the app supports, so it is the only button.
import * as gmail from '../gmail.js';
import { logo, googleG } from '../icons.js';
import { store } from '../store.js';
import { $, html } from '../ui.js';
import { escapeHtml as e } from '../format.js';

const HELP_URL = 'https://github.com/gardarfreyr/larplarp/blob/main/mail/README.md';

/** Shows the sign-in screen and resolves once the user is signed in. */
export function showAuth({ error = '' } = {}) {
  return new Promise((resolve) => {
    const known = store.currentEmail() || store.accountEmails()[0] || null;
    const needsId = !store.getClientId();
    const view = html(`<div class="auth" id="auth">
      <main class="auth-main">
        <div class="auth-logo">${logo()}</div>
        <h1>Your inbox,<br>simplified.</h1>
        <p class="auth-sub">A cleaner, calmer way to email.</p>
        <button type="button" class="btn btn-primary btn-block" data-a="google">${googleG()}<span>${known && !needsId ? `Continue as ${e(known)}` : 'Continue with Google'}</span></button>
        ${known && !needsId ? '<button type="button" class="link-btn" data-a="other" style="margin-top:12px">Use another account</button>' : ''}
        <div class="auth-setup" ${needsId ? '' : 'hidden'}>
          <label for="aClientId">Google OAuth Client ID</label>
          <input id="aClientId" type="text" placeholder="1234567890-abc.apps.googleusercontent.com" autocomplete="off" spellcheck="false" value="${e(store.getClientId())}">
          <p>One-time setup for this copy of the app. <a href="${HELP_URL}" target="_blank" rel="noopener">How to get one</a></p>
        </div>
        ${needsId ? '' : '<button type="button" class="link-btn" data-a="setup" style="margin-top:4px">Change Client ID</button>'}
        <p class="auth-error" role="alert" ${error ? '' : 'hidden'}>${e(error)}</p>
      </main>
      <p class="auth-foot">By continuing, you agree to our <a href="privacy.html" target="_blank" rel="noopener">Terms &amp; Privacy</a>.</p>
    </div>`);
    document.body.append(view);
    const err = $('.auth-error', view);
    const btn = $('[data-a="google"]', view);

    async function go(newAccount) {
      const setup = $('.auth-setup', view);
      const input = $('#aClientId', view);
      if (!setup.hidden) {
        if (!input.value.trim()) { err.textContent = 'Enter your Google OAuth Client ID first.'; err.hidden = false; input.focus(); return; }
        store.setClientId(input.value);
      }
      err.hidden = true;
      btn.disabled = true;
      try {
        await gmail.signIn({ email: newAccount ? null : known, newAccount });
        view.remove();
        resolve();
      } catch (ex) {
        err.textContent = ex.message;
        err.hidden = false;
      } finally {
        btn.disabled = false;
      }
    }

    view.addEventListener('click', (ev) => {
      const a = ev.target.closest('[data-a]');
      if (!a) return;
      if (a.dataset.a === 'google') go(false);
      if (a.dataset.a === 'other') go(true);
      if (a.dataset.a === 'setup') { $('.auth-setup', view).hidden = false; a.remove(); $('#aClientId', view).focus(); }
    });
    $('#aClientId', view).addEventListener('keydown', (ev) => { if (ev.key === 'Enter') go(false); });
    (needsId ? $('#aClientId', view) : btn).focus();
  });
}

