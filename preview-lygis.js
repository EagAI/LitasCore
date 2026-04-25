require('dotenv').config();
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const fs = require('fs');

GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', 'SegoeB');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeui.ttf', 'Segoe');

const BG_PATH = path.join(__dirname, 'src/assets/lygis.png');
const AVATAR_URL = 'https://cdn.discordapp.com/embed/avatars/0.png';

const MOCK = {
  displayName: 'Vardenis',
  username:    'vardenis',
  level:       12,
  xpCurrent:   420,
  xpNeeded:    700,
  pct:         0.60,
  msgs:        847,
  voice:       230,
};

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

(async () => {
  const bg = await loadImage(BG_PATH);
  const W = Math.max(bg.width, 900);
  const H = Math.max(bg.height, 280);

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bg, 0, 0, W, H);

  // Full image dark overlay
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, W, H);

  const pad  = W * 0.03;
  const cardX = pad, cardY = H * 0.07;
  const cardW = W - pad * 2, cardH = H * 0.86;
  const boxR  = 10;


  const gap    = Math.floor(H * 0.045);
  const boxBg  = 'rgba(0,0,0,0.60)';
  const boxPad = Math.floor(W * 0.013);
  const boxR2  = 12;

  // font sizes
  const nameSize  = Math.floor(H * 0.13);
  const tagSize   = Math.floor(H * 0.07);
  const labelSize = Math.floor(H * 0.06);
  const valSize   = Math.floor(H * 0.085);
  const xpLabelSz = Math.floor(H * 0.055);

  // ── Avatar (rounded square, left) ────────────────
  const avatarSz = Math.floor(H * 0.52);
  const avatarR  = 18;
  const avX      = cardX + pad;
  const avY      = cardY + Math.floor((cardH - avatarSz) / 2);

  // red border
  drawRoundRect(ctx, avX - 4, avY - 4, avatarSz + 8, avatarSz + 8, avatarR + 3);
  ctx.fillStyle = '#e03030';
  ctx.fill();

  const avatar = await loadImage(AVATAR_URL);
  ctx.save();
  drawRoundRect(ctx, avX, avY, avatarSz, avatarSz, avatarR);
  ctx.clip();
  ctx.drawImage(avatar, avX, avY, avatarSz, avatarSz);
  ctx.restore();

  // ── Right content ─────────────────────────────────
  const rx = avX + avatarSz + Math.floor(W * 0.04);
  const rw = (cardX + cardW) - rx - pad;

  // helper box
  function box(x, y, w, h) {
    drawRoundRect(ctx, x, y, w, h, boxR2);
    ctx.fillStyle = boxBg;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ── Name + tag row ────────────────────────────────
  const nameY = cardY + Math.floor(cardH * 0.22);
  ctx.shadowColor = '#000'; ctx.shadowBlur = 6;
  ctx.font      = `bold ${nameSize}px SegoeB`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'left';
  ctx.fillText(MOCK.displayName, rx, nameY, rw);

  ctx.font      = `${tagSize}px Segoe`;
  ctx.fillStyle = '#888888';
  ctx.shadowBlur = 0;
  ctx.fillText(`@${MOCK.username}`, rx, nameY + tagSize * 1.5, rw);

  // ── XP bar (below name) ───────────────────────────
  const barH   = Math.max(10, Math.floor(H * 0.065));
  const barR2  = barH / 2;
  const barY   = nameY + tagSize * 1.5 + gap;
  const barW   = rw;

  // XP labels
  ctx.font      = `${xpLabelSz}px Segoe`;
  ctx.fillStyle = '#888888';
  ctx.textAlign = 'left';
  ctx.fillText('XP', rx, barY - Math.floor(xpLabelSz * 0.4));
  ctx.textAlign  = 'right';
  ctx.fillStyle  = '#cccccc';
  ctx.fillText(`${MOCK.xpCurrent} / ${MOCK.xpNeeded}  (${Math.floor(MOCK.pct * 100)}%)`, rx + barW, barY - Math.floor(xpLabelSz * 0.4));

  // track
  drawRoundRect(ctx, rx, barY, barW, barH, barR2);
  ctx.fillStyle = 'rgba(255,255,255,0.10)';
  ctx.fill();

  // fill
  const fillW = Math.max(barR2 * 2, barW * MOCK.pct);
  drawRoundRect(ctx, rx, barY, fillW, barH, barR2);
  ctx.fillStyle = '#e03030';
  ctx.fill();

  // shine
  drawRoundRect(ctx, rx, barY, fillW, barH / 2, barR2);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();

  // ── Stat boxes (Lygis | Žinutės | Voice) ─────────
  const statBoxH = labelSize + valSize + Math.floor(boxPad * 3);
  const statBoxW = (rw - gap * 2) / 3;
  const statY    = barY + barH + gap;

  function statBox(x, y, w, h, label, value) {
    box(x, y, w, h);
    const innerH  = labelSize + valSize * 1.15;
    const textTop = y + Math.floor((h - innerH) / 2) + labelSize;
    ctx.shadowBlur = 0;
    ctx.font      = `${labelSize}px Segoe`;
    ctx.fillStyle = '#888888';
    ctx.textAlign = 'left';
    ctx.fillText(label, x + boxPad, textTop);
    ctx.font      = `bold ${valSize}px SegoeB`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(value, x + boxPad, textTop + valSize * 1.15, w - boxPad * 2);
  }

  statBox(rx,                        statY, statBoxW, statBoxH, 'Lygis',       `${MOCK.level}`);
  statBox(rx + statBoxW + gap,       statY, statBoxW, statBoxH, 'Žinutės',     `${MOCK.msgs}`);
  statBox(rx + (statBoxW + gap) * 2, statY, statBoxW, statBoxH, 'Voice (min)', `${MOCK.voice}`);


  const out = path.join(__dirname, 'lygis-card-preview.png');
  fs.writeFileSync(out, canvas.toBuffer('image/png'));
  console.log(`✅ Išsaugota: ${out}`);
})();
