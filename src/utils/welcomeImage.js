const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const path = require('path');

GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeuib.ttf', 'SegoeB');
GlobalFonts.registerFromPath('C:/Windows/Fonts/segoeui.ttf', 'Segoe');

const BG_PATH = path.join(__dirname, '../assets/welcome.png');

async function generateWelcomeImage(member) {
  const bg = await loadImage(BG_PATH);

  const W = bg.width;
  const H = bg.height;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bg, 0, 0, W, H);

  const avatarSize = Math.floor(Math.min(W, H) * 0.42);
  const cx = W / 2;
  const cy = H / 2 - avatarSize * 0.05;
  const radius = avatarSize / 2;
  const borderWidth = Math.max(5, Math.floor(radius * 0.09));

  const avatarUrl = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  const avatar = await loadImage(avatarUrl);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + borderWidth, 0, Math.PI * 2);
  ctx.fillStyle = '#e03030';
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, cx - radius, cy - radius, avatarSize, avatarSize);
  ctx.restore();

  const nameY = cy + radius + borderWidth + Math.floor(H * 0.09);
  const nameFontSize = Math.floor(Math.min(W, H) * 0.085);
  ctx.font = `bold ${nameFontSize}px SegoeB`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e03030';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 8;
  ctx.fillText(member.user.username, cx, nameY);

  const greetFontSize = Math.floor(nameFontSize * 0.72);
  ctx.font = `${greetFontSize}px Segoe`;
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#000000';
  ctx.shadowBlur = 6;
  ctx.fillText('Sveiki atvykę!', cx, nameY + greetFontSize + Math.floor(H * 0.025));

  ctx.shadowBlur = 0;

  return canvas.toBuffer('image/png');
}

module.exports = { generateWelcomeImage };
