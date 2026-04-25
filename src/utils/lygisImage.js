const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');
const db = require('../db');

GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', 'SegoeB');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeui.ttf', 'Segoe');

const BG_PATH = path.join(__dirname, '../assets/lygis.png');

const BASE_XP = 100, MULT = 1.3;

function xpFor(level) {
  let t = 0;
  for (let i = 1; i <= level; i++) t += Math.floor(BASE_XP * Math.pow(MULT, i - 1));
  return t;
}

function getProgressInfo(xp) {
  let level = 0;
  while (xpFor(level + 1) <= xp) level++;
  const floor = xpFor(level);
  const ceil  = xpFor(level + 1);
  const current = xp - floor;
  const needed  = ceil - floor;
  return { level, current, needed, pct: needed > 0 ? current / needed : 0 };
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

async function generateLygisImage(member) {
  const bg = await loadImage(BG_PATH);

  // Always render at a comfortable fixed size so text is legible
  const W = Math.max(bg.width,  900);
  const H = Math.max(bg.height, 280);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // Background – stretch to fill
  ctx.drawImage(bg, 0, 0, W, H);

  // Dark overlay card
  const padX = W * 0.025, padY = H * 0.08;
  const cardW = W * 0.95,  cardH = H * 0.84;
  drawRoundRect(ctx, padX, padY, cardW, cardH, 22);
  ctx.fillStyle = 'rgba(0,0,0,0.68)';
  ctx.fill();

  // ── Avatar ────────────────────────────────────────────
  const avatarSize = Math.floor(H * 0.58);
  const radius     = avatarSize / 2;
  const border     = Math.max(4, Math.floor(radius * 0.09));
  const avatarCX   = padX + H * 0.12 + radius + border;
  const avatarCY   = padY + cardH / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, radius + border, 0, Math.PI * 2);
  ctx.fillStyle = '#e03030';
  ctx.fill();
  ctx.restore();

  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const avatar    = await loadImage(avatarUrl);
  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarCX, avatarCY, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(avatar, avatarCX - radius, avatarCY - radius, avatarSize, avatarSize);
  ctx.restore();

  // ── Right content area ────────────────────────────────
  const contentX  = avatarCX + radius + border + W * 0.04;
  const contentW  = (padX + cardW) - contentX - W * 0.025;
  const contentMY = padY + cardH / 2;

  // Fetch DB data
  const record = db
    .prepare(
      'SELECT xp, total_messages, total_voice_minutes, voice_joined_at FROM levels WHERE user_id=? AND guild_id=?'
    )
    .get(member.id, member.guild.id);

  const xp   = record?.xp || 0;
  const info = getProgressInfo(xp);
  const msgs = record?.total_messages || 0;
  let voiceMin = record?.total_voice_minutes || 0;
  // Dabartinė voice sesija (iki išėjimo įrašoma į DB) — ta pati apvalinimo logika kaip trackVoiceLeave
  if (record?.voice_joined_at) {
    const ms = Date.now() - record.voice_joined_at;
    voiceMin += Math.round(ms / 60000);
  }

  const displayName = member.nickname || member.user.displayName || member.user.username;

  // Font sizes relative to card height
  const nameSize  = Math.floor(H * 0.175);
  const tagSize   = Math.floor(H * 0.105);
  const statLabel = Math.floor(H * 0.09);
  const statValue = Math.floor(H * 0.115);

  ctx.shadowColor = '#000000';

  // Name
  ctx.font      = `bold ${nameSize}px SegoeB`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowBlur = 10;
  ctx.textAlign = 'left';
  const nameY   = contentMY - H * 0.22;
  ctx.fillText(displayName, contentX, nameY, contentW);

  // @tag
  ctx.font      = `${tagSize}px Segoe`;
  ctx.fillStyle = '#aaaaaa';
  ctx.shadowBlur = 4;
  ctx.fillText(`@${member.user.username}`, contentX, nameY + tagSize * 1.4, contentW);

  // Stats row: Lygis | Žinutės | Voice
  const statY     = nameY + tagSize * 1.4 + H * 0.12;
  const colGap    = contentW / 3;

  function drawStat(x, label, value) {
    ctx.font      = `${statLabel}px Segoe`;
    ctx.fillStyle = '#999999';
    ctx.shadowBlur = 0;
    ctx.fillText(label, x, statY);
    ctx.font      = `bold ${statValue}px SegoeB`;
    ctx.fillStyle = '#ffffff';
    ctx.shadowBlur = 4;
    ctx.fillText(value, x, statY + statValue * 1.1);
  }

  drawStat(contentX,             'Lygis',         `${info.level}`);
  drawStat(contentX + colGap,    'Žinutės',       `${msgs}`);
  drawStat(contentX + colGap*2,  'Voice (min)',   `${voiceMin}`);

  // ── XP progress bar ───────────────────────────────────
  const barH   = Math.max(12, Math.floor(H * 0.065));
  const barR   = barH / 2;
  const barY   = padY + cardH - barH - H * 0.065;
  const barX   = contentX;
  const barW   = contentW;

  // track
  ctx.shadowBlur = 0;
  drawRoundRect(ctx, barX, barY, barW, barH, barR);
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fill();

  // fill – solid red
  const fillW = Math.max(barR * 2, barW * info.pct);
  drawRoundRect(ctx, barX, barY, fillW, barH, barR);
  ctx.fillStyle = '#e03030';
  ctx.fill();

  // subtle shine on bar
  drawRoundRect(ctx, barX, barY, fillW, barH / 2, barR);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();

  // XP text above bar
  const xpLabelSize = Math.floor(H * 0.09);
  ctx.font      = `${xpLabelSize}px Segoe`;
  ctx.fillStyle = '#aaaaaa';
  ctx.textAlign = 'left';
  ctx.fillText('XP', barX, barY - xpLabelSize * 0.3);

  ctx.textAlign  = 'right';
  ctx.fillStyle  = '#cccccc';
  ctx.fillText(
    `${info.current} / ${info.needed}  (${Math.floor(info.pct * 100)}%)`,
    barX + barW,
    barY - xpLabelSize * 0.3
  );

  ctx.textAlign  = 'left';
  ctx.shadowBlur = 0;

  return canvas.toBuffer('image/png');
}

module.exports = { generateLygisImage };
