// 작은 DOM 도우미 — 문자열 HTML 대신 요소를 만들어 XSS를 피한다.
import { DAMAGE_TYPES, DAMAGE_STATUS, REPORT_STATUS, ROLES } from '../core/constants.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  Object.entries(attrs ?? {}).forEach(([k, v]) => {
    if (v === undefined || v === null || v === false) return;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v; // 신뢰할 수 있는 고정 문자열(아이콘)만 사용
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  });
  append(el, children);
  return el;
}

export function append(el, children) {
  children.flat(Infinity).forEach((c) => {
    if (c === null || c === undefined || c === false) return;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  });
  return el;
}

export const clear = (el) => {
  while (el.firstChild) el.firstChild.remove();
  return el;
};

// 비우고 채우기(null·false는 건너뜀)
export const fill = (el, ...children) => append(clear(el), children);

export const dateText = (v) => (!v ? '-' : v === 'unknown' ? '미상' : String(v).slice(0, 10));
export const dateTimeText = (v) => {
  if (!v) return '-';
  const d = new Date(v);
  if (Number.isNaN(d.getTime()) || !String(v).includes('T')) return String(v).replace('T', ' ').slice(0, 16);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const chip = (text, tone = '') => h('span', { class: `chip ${tone}` }, text);
export const reportChip = (s) => chip(REPORT_STATUS[s]?.label ?? s, REPORT_STATUS[s]?.tone ?? '');
export const damageChip = (s) => chip(DAMAGE_STATUS[s]?.label ?? s, DAMAGE_STATUS[s]?.tone ?? '');
export const roleText = (r) => ROLES[r]?.label ?? r;
export const typeChip = (t) => {
  const d = DAMAGE_TYPES[t] ?? DAMAGE_TYPES.ETC;
  return h('span', { class: 'chip', style: { color: d.color } }, h('span', { class: 'dot' }), d.label);
};

export function photoGrid(photos = []) {
  if (!photos.length) return h('div', { class: 'muted small' }, '사진 없음');
  return h('div', { class: 'photos' }, photos.map((p) => h('img', { src: p.thumb || p.src, alt: '파손 사진', loading: 'lazy', onclick: () => lightbox(p.src) })));
}

export function lightbox(src) {
  const box = h('div', { class: 'lightbox', onclick: () => box.remove() }, h('img', { src, alt: '사진 크게 보기' }));
  document.body.append(box);
}

export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function spinner(text = '불러오는 중…') {
  return h('div', { class: 'empty' }, text);
}
