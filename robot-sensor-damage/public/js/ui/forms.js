// 공통 입력 묶음
import { DAMAGE_TYPES } from '../core/constants.js';
import { getModel } from '../core/sensorModels.js';
import { h, todayStr } from './dom.js';

export function typePicker(initial) {
  let value = initial ?? null;
  const btns = Object.entries(DAMAGE_TYPES).map(([k, t]) => {
    const b = h('button', { type: 'button', class: k === value ? 'active' : '', onclick: () => {
      value = k;
      btns.forEach((x) => x.classList.toggle('active', x === b));
    } }, h('span', { class: 'sw', style: { background: t.color } }), t.label);
    return b;
  });
  return { el: h('div', { class: 'type-grid', role: 'group', 'aria-label': '파손 유형' }, btns), value: () => value };
}

export function partSelect(modelId, initial) {
  const parts = getModel(modelId).parts;
  return h('select', {}, Object.entries(parts).map(([k, label]) => h('option', { value: k, selected: k === initial }, label)));
}

export const dateInput = (value = todayStr()) => h('input', { type: 'date', value, max: todayStr() });
