// 3D 위에 파손 모양(점·선·원·영역)을 그리는 도구 막대 — 관리자용
import { SHAPES } from '../core/constants.js';
import { h, clear, fill } from '../ui/dom.js';

const GUIDE = {
  POINT: '파손 위치를 한 번 누르세요.',
  LINE: '긁힌 선을 따라 점을 차례로 누르세요 (2개 이상).',
  CIRCLE: '가운데를 누른 뒤 가장자리를 누르세요.',
  AREA: '영역 둘레를 따라 점을 누르세요 (3개 이상).',
};

export function startDrawTool(viewer, host, { title = '모양 그리기', shape = 'LINE', preset = [], onDone, onCancel }) {
  let current = shape;
  const status = h('span', { class: 'small' });
  const finishBtn = h('button', { class: 'primary small', disabled: true }, '완료');
  const shapeBtns = Object.entries(SHAPES).map(([k, label]) => h('button', { class: `small ${k === current ? 'active' : ''}`, onclick: () => {
    current = k;
    shapeBtns.forEach((b) => b.classList.toggle('active', b.textContent === label));
    viewer.startDraw(k);
  } }, label));
  const bar = h('div', { class: 'draw-bar' },
    h('b', { class: 'small' }, title), ...shapeBtns, status, h('span', { class: 'spacer' }),
    h('button', { class: 'small', onclick: () => viewer.undoDraw() }, '되돌리기'),
    h('button', { class: 'small', onclick: () => { stop(); onCancel?.(); } }, '취소'),
    finishBtn);
  const stop = () => {
    viewer.onDrawChange = null;
    viewer.cancelDraw();
    bar.remove();
  };
  viewer.onDrawChange = (s) => {
    fill(status, s.count ? `${GUIDE[s.shape]} · 점 ${s.count}개` : GUIDE[s.shape]);
    finishBtn.disabled = !s.ready;
  };
  finishBtn.addEventListener('click', () => {
    const r = viewer.finishDraw();
    if (!r) return;
    stop();
    onDone?.(r);
  });
  host.append(bar);
  viewer.startDraw(current, preset);
  return { stop };
}
