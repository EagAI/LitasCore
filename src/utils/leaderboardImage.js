const path = require('path');
const fs = require('fs');
const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const db = require('../db');

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

async function resolveEntry(guild, client, row) {
  let display = 'Nežinomas narys';
  let avatarUrl = null;
  try {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (member) {
      display = member.displayName || member.user.username;
      avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 64 });
    }
  } catch (_) {
    /* */
  }
  if (!avatarUrl) {
    try {
      const u = await client.users.fetch(row.user_id).catch(() => null);
      if (u) {
        display = u.globalName || u.username;
        avatarUrl = u.displayAvatarURL({ extension: 'png', size: 64 });
      }
    } catch (_) {
      /* */
    }
  }
  if (display.length > 24) display = `${display.slice(0, 22)}…`;
  return { display, avatarUrl };
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

/** Top 15 pagal XP — juodas fonas (vėliau galima įkelti custom BG paveikslą). */
async function generateLeaderboardImage(guild, client) {
  const rows = db
    .prepare(
      'SELECT user_id, xp, level FROM levels WHERE guild_id = ? ORDER BY xp DESC LIMIT 15'
    )
    .all(guild.id);

  const W = 940;
  const pad = 40;
  const headerH = 96;
  const rowH = 50;
  const foot = 36;
  const H = rows.length === 0 ? 320 : pad * 2 + headerH + rowH * rows.length + foot;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

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

  if (rows.length === 0) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = font('b', 34);
    ctx.fillText('Lyderių dar nėra', W / 2, H / 2 - 14);
    ctx.font = font('r', 17);
    ctx.fillStyle = 'rgba(255,255,255,0.52)';
    ctx.fillText('Rašyk kanaluose — pradėk rinkti XP', W / 2, H / 2 + 28);
    return canvas.toBuffer('image/png');
  }

  ctx.textAlign = 'left';

  ctx.fillStyle = '#ffffff';
  ctx.font = font('b', 34);
  ctx.fillText('LYDERIŲ LENTELĖ', pad + 6, pad + 46);

  ctx.font = font('r', 14);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  const sub = guild.name.length > 48 ? `${guild.name.slice(0, 46)}…` : guild.name;
  ctx.fillText(sub.toUpperCase(), pad + 6, pad + 76);

  const colRank = pad + 10;
  const colAvatar = colRank + 46;
  const colName = colAvatar + 48;
  const colLevel = W - pad - 200;
  const colXp = W - pad - 10;

  ctx.font = font('r', 11);
  ctx.fillStyle = 'rgba(255,255,255,0.38)';
  ctx.fillText('#', colRank, pad + headerH - 6);
  ctx.fillText('NARY', colName, pad + headerH - 6);
  ctx.textAlign = 'right';
  ctx.fillText('LYGIS', colLevel, pad + headerH - 6);
  ctx.fillText('XP', colXp, pad + headerH - 6);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(pad + 2, pad + headerH + 4);
  ctx.lineTo(W - pad - 2, pad + headerH + 4);
  ctx.stroke();

  const resolved = [];
  for (let i = 0; i < rows.length; i++) {
    const meta = await resolveEntry(guild, client, rows[i]);
    resolved.push({
      rank: i + 1,
      ...meta,
      level: rows[i].level,
      xp: rows[i].xp,
    });
  }

  let y = pad + headerH + 16;
  for (let i = 0; i < resolved.length; i++) {
    const e = resolved[i];
    if (i % 2 === 1) {
      ctx.fillStyle = ROW_ALT;
      drawRoundRect(ctx, pad + 2, y - 6, W - pad * 2 - 4, rowH - 4, 12);
      ctx.fill();
    }

    let rankColor = 'rgba(255,255,255,0.88)';
    if (e.rank === 1) rankColor = TOP1;
    else if (e.rank === 2) rankColor = TOP2;
    else if (e.rank === 3) rankColor = TOP3;

    ctx.fillStyle = rankColor;
    ctx.font = font('b', 17);
    ctx.fillText(String(e.rank), colRank, y + 22);

    const avR = 17;
    const avX = colAvatar;
    const avY = y + 4;
    if (e.avatarUrl) {
      try {
        const av = await loadImage(e.avatarUrl);
        ctx.save();
        ctx.beginPath();
        ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(av, avX, avY, avR * 2, avR * 2);
        ctx.restore();
        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
        ctx.stroke();
      } catch {
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        ctx.beginPath();
        ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.arc(avX + avR, avY + avR, avR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#f0f2f8';
    ctx.font = font('r', 16);
    ctx.fillText(e.display, colName, y + 22);

    ctx.textAlign = 'right';
    ctx.fillStyle = ACCENT;
    ctx.font = font('b', 16);
    ctx.fillText(String(e.level), colLevel, y + 22);

    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = font('r', 15);
    ctx.fillText(Number(e.xp).toLocaleString('lt-LT'), colXp, y + 22);
    ctx.textAlign = 'left';

    y += rowH;
  }

  ctx.textAlign = 'left';
  ctx.font = font('r', 12);
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText('Top 15 pagal bendrą XP', pad + 6, H - pad + 10);

  return canvas.toBuffer('image/png');
}

module.exports = { generateLeaderboardImage };
