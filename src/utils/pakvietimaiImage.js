const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const db = require('../db');
const { countInvitesByInviter, getInviteStats } = require('../services/inviteTracking');

(() => {
  const root = process.env.SystemRoot || 'C:/Windows';
  const tries = [
    path.join(root, 'Fonts/segoeuib.ttf'),
    path.join(root, 'Fonts/segoeui.ttf'),
  ];
  try {
    if (fs.existsSync(tries[0])) GlobalFonts.registerFromPath(tries[0], 'SegoeB');
    if (fs.existsSync(tries[1])) GlobalFonts.registerFromPath(tries[1], 'Segoe');
  } catch (_) {
    /* VPS be Segoe — naudos built-in sans */
  }
})();

/** @param {'b'|'r'} weight */
function font(weight, px) {
  const b = fs.existsSync(path.join(process.env.SystemRoot || 'C:/Windows', 'Fonts/segoeuib.ttf'));
  const r = fs.existsSync(path.join(process.env.SystemRoot || 'C:/Windows', 'Fonts/segoeui.ttf'));
  if (weight === 'b' && b) return `bold ${px}px SegoeB`;
  if (weight === 'r' && r) return `${px}px Segoe`;
  return weight === 'b' ? `bold ${px}px system-ui, sans-serif` : `${px}px system-ui, sans-serif`;
}

function drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

const ACCENT = '#e03030';
const ROW_ALT = 'rgba(255,255,255,0.04)';
const TOP1 = '#ffd447';
const TOP2 = '#c8d5e8';
const TOP3 = '#e8a065';

function getInviteLeaderboardRank(guildId, userId) {
  const rows = db
    .prepare(
      `SELECT user_id FROM invite_stats
       WHERE guild_id = ? AND valid_count > 0
       ORDER BY valid_count DESC`
    )
    .all(guildId);
  const idx = rows.findIndex(r => r.user_id === userId);
  return idx >= 0 ? idx + 1 : null;
}

function rankValueColor(rank) {
  if (rank === 1) return TOP1;
  if (rank === 2) return TOP2;
  if (rank === 3) return TOP3;
  return ACCENT;
}

async function resolveUserProfile(guild, client, userId) {
  let display = 'Nežinomas narys';
  let avatarUrl = null;
  try {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) {
      display = member.displayName || member.user.username;
      avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 128 });
    }
  } catch (_) {
    /* */
  }
  if (!avatarUrl) {
    try {
      const u = await client.users.fetch(userId).catch(() => null);
      if (u) {
        display = u.globalName || u.username;
        avatarUrl = u.displayAvatarURL({ extension: 'png', size: 128 });
      }
    } catch (_) {
      /* */
    }
  }
  if (display.length > 28) display = `${display.slice(0, 26)}…`;
  return { display, avatarUrl };
}

function drawBackground(ctx, W, H, pad) {
  ctx.fillStyle = '#060608';
  ctx.fillRect(0, 0, W, H);

  const vign = ctx.createRadialGradient(W * 0.45, 0, 0, W * 0.55, H * 0.35, W);
  vign.addColorStop(0, 'rgba(224,48,48,0.14)');
  vign.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = vign;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 1;
  drawRoundRect(ctx, pad * 0.45, pad * 0.45, W - pad * 0.9, H - pad * 0.9, 26);
  ctx.stroke();
}

function drawStatRow(ctx, { y, label, value, valueColor, pad, W, rowH, alt }) {
  if (alt) {
    ctx.fillStyle = ROW_ALT;
    drawRoundRect(ctx, pad + 2, y - 6, W - pad * 2 - 4, rowH - 4, 12);
    ctx.fill();
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = '#f0f2f8';
  ctx.font = font('r', 16);
  ctx.fillText(label, pad + 6, y + 22);

  ctx.textAlign = 'right';
  ctx.fillStyle = valueColor;
  ctx.font = font('b', 16);
  ctx.fillText(value, W - pad - 10, y + 22);
  ctx.textAlign = 'left';
}

async function drawAvatar(ctx, x, y, radius, avatarUrl) {
  if (avatarUrl) {
    try {
      const av = await loadImage(avatarUrl);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(av, x, y, radius * 2, radius * 2);
      ctx.restore();
      ctx.strokeStyle = 'rgba(255,255,255,0.14)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
      ctx.stroke();
      return;
    } catch {
      /* fallback */
    }
  }

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x + radius, y + radius, radius, 0, Math.PI * 2);
  ctx.stroke();
}

/** Asmeninė pakvietimų statistika (canvas PNG). */
async function generatePakvietimaiImage(guild, client, userId) {
  const profile = await resolveUserProfile(guild, client, userId);
  const stats = getInviteStats(userId, guild.id);
  const invalidCount = countInvitesByInviter(guild.id, userId, 'invalid');
  const rank = getInviteLeaderboardRank(guild.id, userId);

  const W = 940;
  const pad = 40;
  const avR = 34;
  const profileH = avR * 2 + 8;
  const subtitleH = 28;
  const statRowH = 50;
  const foot = 36;
  const statCount = 3;
  const H = pad * 2 + profileH + subtitleH + 12 + statRowH * statCount + foot;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  drawBackground(ctx, W, H, pad);

  const avX = pad + 6;
  const avY = pad + 6;
  await drawAvatar(ctx, avX, avY, avR, profile.avatarUrl);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.font = font('b', 30);
  const nameX = avX + avR * 2 + 20;
  const nameY = avY + avR + 10;
  ctx.fillText(profile.display, nameX, nameY);

  const subtitleY = avY + avR * 2 + 22;
  ctx.font = font('r', 14);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('TAVO PAKVIETIMAI', pad + 6, subtitleY);

  let y = pad + profileH + subtitleH + 8;

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(pad + 2, y);
  ctx.lineTo(W - pad - 2, y);
  ctx.stroke();

  y += 16;

  const rankValue = rank != null ? `${rank} vieta` : '—';
  const rankColor = rank != null ? rankValueColor(rank) : 'rgba(255,255,255,0.45)';

  const statRows = [
    { label: 'Šiuo metu pakvietėte', value: String(stats.validCount), color: ACCENT },
    {
      label: 'Nepriskaityti dėl priežasčių',
      value: String(invalidCount),
      color: 'rgba(255,255,255,0.72)',
    },
    { label: 'Lyderių lentelėje esate', value: rankValue, color: rankColor },
  ];

  for (let i = 0; i < statRows.length; i++) {
    drawStatRow(ctx, {
      y,
      label: statRows[i].label,
      value: statRows[i].value,
      valueColor: statRows[i].color,
      pad,
      W,
      rowH: statRowH,
      alt: i % 2 === 1,
    });
    y += statRowH;
  }

  ctx.textAlign = 'left';
  ctx.font = font('r', 12);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText('Asmeninė pakvietimų statistika', pad + 6, H - pad + 10);

  return canvas.toBuffer('image/png');
}

module.exports = { generatePakvietimaiImage, getInviteLeaderboardRank };
