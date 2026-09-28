/**
 * Progressive enhancement only. Everything here also works without it:
 * forms post natively and get a redirect; the menu falls back to links.
 * Shipped as dist/assets/site.<hash>.js; CSP forbids inline scripts.
 */
(() => {
  'use strict';

  // --- Mobile menu -----------------------------------------------------
  const toggle = document.querySelector('[data-menu-toggle]');
  const menu = document.querySelector('[data-menu]');
  if (toggle instanceof HTMLButtonElement && menu instanceof HTMLElement) {
    menu.hidden = true;
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      menu.hidden = open;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        toggle.setAttribute('aria-expanded', 'false');
        menu.hidden = true;
        toggle.focus();
      }
    });
  }

  // --- Hero video: skip on Save-Data + narrow screens, honour reduced motion
  const video = document.querySelector('video[data-hero]');
  if (video instanceof HTMLVideoElement) {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrow = matchMedia('(max-width: 640px)').matches;
    const connection = /** @type {{ saveData?: boolean } | undefined} */ (
      /** @type {any} */ (navigator).connection
    );
    const saveData = connection?.saveData === true;
    if (reduced || (narrow && saveData)) {
      video.removeAttribute('autoplay');
      video.pause();
      for (const source of video.querySelectorAll('source')) source.remove();
      video.load(); // drops the pending request; poster stays
    }
  }

  // --- Forms: fetch instead of navigate, dedupe with form_id ------------
  for (const form of document.querySelectorAll('form[data-enhance]')) {
    if (!(form instanceof HTMLFormElement)) continue;
    const formId = form.querySelector('input[name="form_id"]');
    if (formId instanceof HTMLInputElement) formId.value = crypto.randomUUID();

    const status = form.querySelector('[data-status]');
    const button = form.querySelector('button[type="submit"]');
    const setStatus = (/** @type {string} */ text, ok = true) => {
      if (!status) return;
      status.textContent = text;
      status.classList.toggle('text-red-700', !ok);
    };

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (button instanceof HTMLButtonElement) button.disabled = true;
      setStatus('Sending…');
      try {
        const fields = /** @type {Record<string, string>} */ ({});
        for (const [k, v] of new FormData(form)) if (typeof v === 'string') fields[k] = v;
        const res = await fetch(form.action, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(fields),
        });
        if (res.status === 202) {
          setStatus(form.dataset.success || 'Thanks, message received.');
          form.reset();
          if (formId instanceof HTMLInputElement) formId.value = crypto.randomUUID();
        } else if (res.status === 429) {
          setStatus('Too many attempts. Please try again in a few minutes.', false);
        } else if (res.status === 422) {
          setStatus('Please check the fields and try again.', false);
        } else {
          setStatus('Something went wrong. Please email instead.', false);
        }
      } catch {
        setStatus('Network error. Please try again.', false);
      } finally {
        if (button instanceof HTMLButtonElement) button.disabled = false;
      }
    });
  }
})();
