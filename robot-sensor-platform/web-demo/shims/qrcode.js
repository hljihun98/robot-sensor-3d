// qrcode — QR 행렬은 원래 라이브러리로 만들고, PNG는 캔버스로 그린다(서비스 워커에는 document가 없다).
import QR from 'qrcode';

async function toBuffer(text, { width = 360, margin = 2 } = {}) {
  const qr = QR.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const scale = Math.max(1, Math.floor(width / (n + margin * 2)));
  const px = (n + margin * 2) * scale;
  const canvas = new OffscreenCanvas(px, px);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000000';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) if (qr.modules.get(y, x)) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return Buffer.from(await blob.arrayBuffer());
}
export default { toBuffer };
