// Touch gestures for email rows: swipe right to archive, swipe left to reveal
// Read / Star / Delete, and long-press to start selecting.
import { icon } from './icons.js';
import { haptic } from './ui.js';

const TRAY = 228;            // 3 buttons × 76px
const LONG_PRESS_MS = 450;

/**
 * @param {HTMLElement} list  the <ul> holding .row-wrap items
 * @param {{ describe(id): {unread:boolean, starred:boolean, archivable:boolean, archiveLabel:string},
 *           onArchive(id), onAction(id, action), onLongPress(id), enabled(): boolean }} opts
 */
export function attachSwipe(list, opts) {
  let g = null;          // current gesture
  let openWrap = null;   // row whose action tray is open

  const rowOf = (wrap) => wrap.querySelector('.email-row');

  function closeOpen(animate = true) {
    if (!openWrap) return;
    const row = rowOf(openWrap);
    row.style.transition = animate ? '' : 'none';
    row.style.transform = '';
    const w = openWrap;
    openWrap = null;
    setTimeout(() => w.querySelectorAll('.swipe-bg').forEach((n) => n.remove()), 220);
  }

  function ensureBackgrounds(wrap, id) {
    if (wrap.querySelector('.swipe-bg')) return;
    const d = opts.describe(id);
    wrap.insertAdjacentHTML('afterbegin',
      `<div class="swipe-bg swipe-left-bg" aria-hidden="true">${icon(d.archivable ? 'archive' : 'inbox')}<span>${d.archiveLabel}</span></div>
       <div class="swipe-bg swipe-actions">
         <button type="button" data-swipe="read" tabindex="-1">${icon(d.unread ? 'mailOpen' : 'mail')}<span>${d.unread ? 'Mark read' : 'Mark unread'}</span></button>
         <button type="button" data-swipe="star" tabindex="-1">${icon('star')}<span>${d.starred ? 'Unstar' : 'Star'}</span></button>
         <button type="button" data-swipe="delete" class="is-danger" tabindex="-1">${icon('trash')}<span>Delete</span></button>
       </div>`);
  }

  function showSide(wrap, dx) {
    const left = wrap.querySelector('.swipe-left-bg');
    const tray = wrap.querySelector('.swipe-actions');
    if (left) left.style.visibility = dx > 0 ? 'visible' : 'hidden';
    if (tray) tray.style.visibility = dx < 0 ? 'visible' : 'hidden';
  }

  list.addEventListener('pointerdown', (ev) => {
    if (ev.pointerType === 'mouse' || !opts.enabled()) return;
    const wrap = ev.target.closest('.row-wrap');
    if (!wrap || ev.target.closest('.swipe-actions')) return;
    if (openWrap && openWrap !== wrap) closeOpen();
    g = { wrap, id: wrap.dataset.id, x: ev.clientX, y: ev.clientY, dx: 0, mode: null, pointerId: ev.pointerId,
      base: openWrap === wrap ? -TRAY : 0 };
    g.timer = setTimeout(() => {
      if (g && !g.mode) { g.mode = 'longpress'; haptic(15); wrap.dataset.suppressClick = '1'; opts.onLongPress(g.id); }
    }, LONG_PRESS_MS);
  });

  list.addEventListener('pointermove', (ev) => {
    if (!g || ev.pointerId !== g.pointerId) return;
    const dx = ev.clientX - g.x;
    const dy = ev.clientY - g.y;
    if (!g.mode) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { clearTimeout(g.timer); g = null; return; }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        clearTimeout(g.timer);
        g.mode = 'swipe';
        ensureBackgrounds(g.wrap, g.id);
        rowOf(g.wrap).classList.add('is-dragging');
        try { g.wrap.setPointerCapture(ev.pointerId); } catch {}
      } else return;
    }
    if (g.mode !== 'swipe') return;
    let x = g.base + dx;
    if (x < -TRAY) x = -TRAY - (-TRAY - x) * 0.25;       // resistance past the tray
    g.dx = x;
    showSide(g.wrap, x);
    rowOf(g.wrap).style.transform = `translateX(${x}px)`;
    if (!g.armed && x > g.wrap.offsetWidth * 0.35) { g.armed = true; haptic(); }
    if (g.armed && x < g.wrap.offsetWidth * 0.35) g.armed = false;
  });

  function end() {
    if (!g) return;
    clearTimeout(g.timer);
    const { wrap, id, mode, dx } = g;
    g = null;
    if (mode !== 'swipe') return;
    const row = rowOf(wrap);
    row.classList.remove('is-dragging');
    wrap.dataset.suppressClick = '1';
    const width = wrap.offsetWidth;
    if (dx > width * 0.35) {
      row.style.transform = `translateX(${width}px)`;
      setTimeout(() => opts.onArchive(id), 180);
    } else if (dx < -60) {
      row.style.transform = `translateX(${-TRAY}px)`;
      openWrap = wrap;
    } else {
      row.style.transform = '';
      if (openWrap === wrap) openWrap = null;
      setTimeout(() => { if (openWrap !== wrap) wrap.querySelectorAll('.swipe-bg').forEach((n) => n.remove()); }, 220);
    }
  }
  list.addEventListener('pointerup', end);
  list.addEventListener('pointercancel', end);

  list.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-swipe]');
    if (btn) {
      ev.stopPropagation();
      const wrap = btn.closest('.row-wrap');
      haptic();
      closeOpen();
      opts.onAction(wrap.dataset.id, btn.dataset.swipe);
    }
  }, true);

  document.addEventListener('pointerdown', (ev) => {
    if (openWrap && !openWrap.contains(ev.target)) closeOpen();
  });

  return { closeOpen };
}
