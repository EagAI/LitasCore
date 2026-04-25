const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const db = require('../db');

GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', 'SegoeB');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeui.ttf', 'Segoe');

const BG_PATH = path.join(__dirname, '../assets/profile.png');

const BASE = 100, MULT = 1.3;
function xpFor(level) {
  let t = 0;
  for (let i = 1; i <= level; i++) t += Math.floor(BASE * Math.pow(MULT, i - 1));
  return t;
}

function getLevelFromXp(xp) {
  let level = 0;
  while (xpFor(level + 1) <= xp) level++;
  return level;
}

function getXpProgress(xp) {
  const level = getLevelFromXp(xp);
  const current = xp - xpFor(level);
  const needed = xpFor(level + 1) - xpFor(level);
  return { level, current, needed, pct: needed > 0 ? current / needed : 0 };
}

function shortDate(ms) {
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function generateProfileImage(member, overrides = {}) {
  const bg = await loadImage(BG_PATH);
  const W = bg.width, H = bg.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bg, 0, 0, W, H);

  const padX = W * 0.03, padY = H * 0.07;
  const cardW = W * 0.94, cardH = H * 0.86;
  drawRoundRect(ctx, padX, padY, cardW, cardH, 28);
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fill();

  // ── Avatar ──────────────────────────────────────────────
  const avatarSize = Math.floor(H * 0.30);
  const radius = avatarSize / 2;
  const border = Math.max(4, Math.floor(radius * 0.08));
  const leftW = W * 0.26;
  const avatarCX = padX + leftW / 2;
  const avatarCY = padY + cardH * 0.38;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, radius + border, 0, Math.PI * 2);
  ctx.fillStyle = '#e03030';
  ctx.fill();
  ctx.restore();

  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const avatar = await loadImage(avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, avatarCX - radius, avatarCY - radius, avatarSize, avatarSize);
  ctx.restore();

  // ── Name + handle under avatar ───────────────────────────
  const nameFontSize = Math.floor(H * 0.082);
  const tagFontSize = Math.floor(H * 0.054);
  const displayName = member.nickname || member.user.displayName || member.user.username;
  const nameY = avatarCY + radius + border + nameFontSize + Math.floor(H * 0.03);

  ctx.font = `bold ${nameFontSize}px SegoeB`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#000';
  ctx.shadowBlur = 8;
  ctx.fillText(displayName, avatarCX, nameY, leftW - 10);

  ctx.font = `${tagFontSize}px Segoe`;
  ctx.fillStyle = '#aaaaaa';
  ctx.shadowBlur = 4;
  ctx.fillText(`@${member.user.username}`, avatarCX, nameY + tagFontSize * 1.5, leftW - 10);

  ctx.textAlign = 'left';

  // ── Stats ────────────────────────────────────────────────
  const record = db.prepare('SELECT xp FROM levels WHERE user_id = ? AND guild_id = ?').get(member.id, member.guild.id);
  const xp = record?.xp || 0;
  const { level, current: xpCurrent, needed: xpNeeded, pct: xpPct } =
    overrides.level != null
      ? { level: overrides.level, current: 0, needed: 1, pct: 0 }
      : getXpProgress(xp);

  const ecoRow = db.prepare('SELECT balance FROM economy WHERE user_id=? AND guild_id=?').get(member.id, member.guild.id);
  const litai = overrides.litai ?? ecoRow?.balance ?? 0;

  const rightX = padX + leftW + W * 0.04;
  const rightW = (padX + cardW) - rightX - W * 0.03;
  const col1X = rightX;
  const col2X = rightX + rightW * 0.5;

  const labelSize = Math.floor(H * 0.055);
  const valueSize = Math.floor(H * 0.082);
  const rowGap = valueSize * 2.8;
  const blockH = labelSize + valueSize * 1.15 + rowGap + labelSize + valueSize * 1.15;
  const statsStartY = padY + (cardH - blockH) / 2 + labelSize;

  function drawStat(x, y, label, value) {
    ctx.font = `${labelSize}px Segoe`;
    ctx.fillStyle = '#999999';
    ctx.shadowBlur = 0;
    ctx.fillText(label, x, y);
    ctx.font = `bold ${valueSize}px SegoeB`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 5;
    ctx.fillText(value, x, y + valueSize * 1.15);
  }

  drawStat(col1X, statsStartY,           'Lygis',  `${level}`);
  drawStat(col1X, statsStartY + rowGap,  'Litai',  `${litai}`);
  drawStat(col2X, statsStartY,           'Prisijungė į serverį', shortDate(member.joinedTimestamp));
  drawStat(col2X, statsStartY + rowGap,  'Prisijungė į Discord', shortDate(member.user.createdTimestamp));

  // ── XP progress bar ──────────────────────────────────────
  const barH = Math.max(10, Math.floor(H * 0.038));
  const barR = barH / 2;
  const barY = padY + cardH - barH - H * 0.045;
  const barX = rightX;
  const barMaxW = rightW;

  // background track
  ctx.shadowBlur = 0;
  drawRoundRect(ctx, barX, barY, barMaxW, barH, barR);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();

  // filled portion
  const fillW = Math.max(barR * 2, barMaxW * xpPct);
  drawRoundRect(ctx, barX, barY, fillW, barH, barR);
  const grad = ctx.createLinearGradient(barX, 0, barX + barMaxW, 0);
  grad.addColorStop(0, '#e03030');
  grad.addColorStop(1, '#ff7a00');
  ctx.fillStyle = grad;
  ctx.fill();

  // XP label above bar
  const xpLabelSize = Math.floor(H * 0.048);
  ctx.font = `${xpLabelSize}px Segoe`;
  ctx.fillStyle = '#aaaaaa';
  ctx.textAlign = 'left';
  ctx.fillText('XP', barX, barY - xpLabelSize * 0.35);

  // XP numbers right-aligned above bar
  ctx.textAlign = 'right';
  ctx.fillStyle = '#cccccc';
  const pctText = overrides.level != null
    ? `Lv. ${level}`
    : `${xpCurrent} / ${xpNeeded} XP  (${Math.floor(xpPct * 100)}%)`;
  ctx.fillText(pctText, barX + barMaxW, barY - xpLabelSize * 0.35);

  ctx.textAlign = 'left';
  ctx.shadowBlur = 0;
  return canvas.toBuffer('image/png');
}

module.exports = { generateProfileImage };
