const BADGES = [
  { id: 'streamer',       label: 'Streamer',       emoji: '<:streamer:1497245609546088538>' },
  { id: 'vip',            label: 'VIP',             emoji: '<:vip:1497245593691750520>' },
  { id: 'supporteris',    label: 'Supporteris',     emoji: '<:supporteris:1497244653353828472>' },
  { id: 'padeka',         label: 'Padėka',          emoji: '<:padeka:1497243945535541399>' },
  { id: 'administracija', label: 'Administracija',  emoji: '<:administracija:1497243940925997077>' },
];

const BADGE_MAP = Object.fromEntries(BADGES.map(b => [b.id, b]));

module.exports = { BADGES, BADGE_MAP };
