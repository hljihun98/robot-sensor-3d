// 모달·토스트
import { h, clear, fill } from './dom.js';

export function toast(message, kind = '') {
  let box = document.querySelector('.toast-box');
  if (!box) {
    box = h('div', { class: 'toast-box', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = h('div', { class: `toast ${kind}` }, message);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 5000 : 3000);
}

export const toastError = (e) => toast(e?.message ?? String(e), 'error');

// actions: [{ label, primary, danger, onClick(close) → 반환값이 false면 닫지 않음 }]
export function openModal({ title, body, actions = [], wide = false, onClose, locked = false }) {
  const close = () => {
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !locked) close();
  };
  const err = h('div', { class: 'error-box hidden' });
  const foot = h('div', { class: 'modal-foot' });
  const modal = h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h2', {}, title), h('span', { class: 'spacer' }), locked ? null : h('button', { class: 'ghost', 'aria-label': '닫기', onclick: close }, '✕')),
    h('div', { class: 'modal-body' }, err, body),
    foot);
  actions.forEach((a) => {
    const b = h('button', { class: a.primary ? 'primary' : a.danger ? 'danger' : '' }, a.label);
    b.addEventListener('click', async () => {
      err.classList.add('hidden');
      b.disabled = true;
      try {
        const r = a.onClick ? await a.onClick(close) : undefined;
        if (r !== false) close();
      } catch (e) {
        fill(err, e?.message ?? String(e));
        err.classList.remove('hidden');
      } finally {
        b.disabled = false;
      }
    });
    foot.append(b);
  });
  if (!actions.length) foot.remove();
  const back = h('div', { class: 'modal-back', onclick: (e) => e.target === back && !locked && close() }, modal);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  setTimeout(() => modal.querySelector('input, select, textarea')?.focus(), 30);
  return { close, modal };
}

export function confirmModal(title, message, okLabel = '확인', danger = false) {
  return new Promise((resolve) => {
    let ok = false;
    openModal({
      title,
      body: h('p', { style: { margin: 0 } }, message),
      actions: [
        { label: '취소' },
        { label: okLabel, primary: !danger, danger, onClick: () => { ok = true; } },
      ],
      onClose: () => resolve(ok),
    });
  });
}
