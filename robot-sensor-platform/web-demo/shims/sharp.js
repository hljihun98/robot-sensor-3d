// sharp — 브라우저 캔버스로 같은 일을 한다(형식 확인, 방향 보정, 크기 줄이기, JPEG 저장).
import { writeFileNow } from './storage.js';

function sniff(b) {
  const s = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b[0] === 0x89 && s(1, 4) === 'PNG') return 'png';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WEBP') return 'webp';
  if (s(0, 3) === 'GIF') return 'gif';
  return 'unknown';
}

export default function sharp(input, options = {}) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const ops = { resize: null, quality: 0.8 };
  let bitmap = null;
  const decode = () => {
    bitmap ??= createImageBitmap(new Blob([bytes]), { imageOrientation: 'from-image' }).then((b) => {
      if (options.limitInputPixels && b.width * b.height > options.limitInputPixels) throw new Error('Input image exceeds pixel limit');
      return b;
    }, () => {
      throw new Error('Input buffer contains unsupported image format');
    });
    return bitmap;
  };
  const render = async () => {
    const b = await decode();
    let w = b.width;
    let h = b.height;
    if (ops.resize) {
      const scale = Math.min(ops.resize.w / w, ops.resize.h / h, ops.resize.withoutEnlargement ? 1 : Infinity);
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(b, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: ops.quality });
    return new Uint8Array(await blob.arrayBuffer());
  };
  const api = {
    async metadata() {
      const format = sniff(bytes);
      if (!['jpeg', 'png', 'webp'].includes(format)) return { format };
      const b = await decode();
      return { format, width: b.width, height: b.height };
    },
    clone: () => sharp(bytes, options),
    rotate: () => api,
    resize(w, h, o = {}) {
      ops.resize = { w, h, ...o };
      return api;
    },
    jpeg({ quality = 80 } = {}) {
      ops.quality = quality / 100;
      return api;
    },
    async toBuffer() {
      return Buffer.from(await render());
    },
    async toFile(path) {
      const out = await render();
      writeFileNow(path, out);
      return { size: out.length };
    },
  };
  return api;
}
