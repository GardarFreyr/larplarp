// Recipient entry: typed addresses become removable chips; invalid ones are flagged.
import { icon } from '../icons.js';
import { escapeHtml as e, splitAddresses, parseAddress, isValidEmail, displayName, formatAddress } from '../format.js';

export function recipientField(container, { label, onChange }) {
  let list = [];
  container.innerHTML = `<div class="recipients"><input type="email" multiple autocomplete="email" aria-label="${e(label)}"></div>`;
  const box = container.querySelector('.recipients');
  const input = box.querySelector('input');

  function render() {
    box.querySelectorAll('.rcpt').forEach((n) => n.remove());
    list.forEach((a, i) => {
      const valid = isValidEmail(a.email);
      input.insertAdjacentHTML('beforebegin',
        `<span class="rcpt${valid ? '' : ' is-invalid'}" title="${e(a.email)}${valid ? '' : ' (invalid address)'}">
          <span>${e(displayName(a))}</span>
          <button type="button" data-rm="${i}" aria-label="Remove ${e(a.email)}">${icon('x', 'ic-sm')}</button></span>`);
    });
  }

  function add(text) {
    const parts = splitAddresses(text).map(parseAddress).filter((a) => a.email);
    if (!parts.length) return false;
    parts.forEach((a) => {
      if (!list.some((x) => x.email.toLowerCase() === a.email.toLowerCase())) list.push(a);
    });
    render();
    onChange();
    return true;
  }

  function commit() {
    if (input.value.trim()) { add(input.value); input.value = ''; }
  }

  input.addEventListener('keydown', (ev) => {
    if ((ev.key === 'Enter' || ev.key === ',' || ev.key === ';' || (ev.key === 'Tab' && input.value.trim())) && input.value.trim()) {
      ev.preventDefault();
      commit();
    } else if (ev.key === 'Backspace' && !input.value && list.length) {
      list.pop();
      render();
      onChange();
    }
  });
  input.addEventListener('input', () => {
    if (/[,;]\s*$/.test(input.value)) commit();
    onChange();
  });
  input.addEventListener('paste', (ev) => {
    const text = ev.clipboardData?.getData('text') || '';
    if (/[,;\n]/.test(text)) { ev.preventDefault(); add(text.replace(/\n/g, ',')); }
  });
  input.addEventListener('blur', commit);
  box.addEventListener('click', (ev) => {
    const rm = ev.target.closest('[data-rm]');
    if (rm) { list.splice(Number(rm.dataset.rm), 1); render(); onChange(); input.focus(); return; }
    if (ev.target === box) input.focus();
  });

  return {
    input,
    /** Committed recipients plus whatever is typed but not yet turned into a chip. */
    values() {
      const pending = splitAddresses(input.value).map(parseAddress).filter((a) => a.email);
      return list.concat(pending);
    },
    set(addresses) { list = addresses.slice(); input.value = ''; render(); },
    hasInvalid() { return this.values().some((a) => !isValidEmail(a.email)); },
    text() { return this.values().map(formatAddress).join(', '); },
    commit,
    focus() { input.focus(); },
  };
}
