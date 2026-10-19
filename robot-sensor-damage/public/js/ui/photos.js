// 사진 고르기 — 휴대폰에서는 카메라로 바로 찍을 수 있다. 올리기 전에 줄여서(장변 1600px) 용량을 아낀다.
import { h, clear } from './dom.js';

async function resize(file, max, quality) {
  const bmp = await createImageBitmap(file).catch(async () => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  });
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

export function photoPicker({ max = 5, hint = '원거리 1장 + 근접 1장 이상 권장' } = {}) {
  const items = [];
  let work = Promise.resolve();
  const slots = h('div', { class: 'slots' });
  const input = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden' });
  const cam = h('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'hidden' });
  const render = () => {
    clear(slots);
    items.forEach((it, i) => slots.append(h('div', { class: 'slot' }, h('img', { src: it.thumb, alt: `사진 ${i + 1}` }),
      h('button', { type: 'button', 'aria-label': '사진 빼기', onclick: () => { items.splice(i, 1); render(); } }, '✕'))));
    if (items.length < max) {
      slots.append(h('div', { class: 'add', role: 'button', tabindex: '0', onclick: () => cam.click() }, '📷', h('br'), '촬영'));
      slots.append(h('div', { class: 'add', role: 'button', tabindex: '0', onclick: () => input.click() }, '🖼', h('br'), '앨범에서'));
    }
  };
  const onFiles = async (files) => {
    for (const f of [...files].slice(0, max - items.length)) {
      try {
        items.push({ full: await resize(f, 1600, 0.85), thumb: await resize(f, 360, 0.75) });
      } catch {
        /* 읽을 수 없는 파일은 건너뜀 */
      }
    }
    render();
  };
  const queue = (el) => {
    const files = [...el.files];
    el.value = '';
    work = work.then(() => onFiles(files));
  };
  input.addEventListener('change', () => queue(input));
  cam.addEventListener('change', () => queue(cam));
  render();
  const el = h('div', { class: 'photo-picker stack' }, h('div', { class: 'small muted' }, hint), slots, input, cam);
  // 사진 줄이기가 끝날 때까지 기다린 뒤 값을 돌려준다
  return { el, value: async () => { await work; return items.map((x) => ({ ...x })); } };
}
