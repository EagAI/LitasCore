'use strict';

const SIGNALS = [
  { pattern: /activate\s+code\s+for\s+bonus/i, weight: 3, label: 'Bonus code activation prompt' },
  { pattern: /promo\s*code/i, weight: 2, label: 'Promo code mention' },
  { pattern: /enter\s+(the\s+)?(promo|bonus|referral)\s+code/i, weight: 3, label: 'Code entry instruction' },
  { pattern: /exclusive\s+reward/i, weight: 2, label: 'Exclusive reward claim' },
  { pattern: /giving\s+away\s+\$[\d,]+/i, weight: 3, label: 'Dollar giveaway claim' },
  { pattern: /i\s+am\s+giving\s+away/i, weight: 3, label: 'Giveaway announcement' },
  { pattern: /receive\s+your\s+\$[\d,]+\s+bonus/i, weight: 3, label: 'Fake bonus receipt' },
  { pattern: /\$[\d,]+\s+to\s+everyone\s+who\s+registers/i, weight: 4, label: 'Mass payout for registration' },
  { pattern: /withdrawal\s+successful/i, weight: 3, label: 'Fake withdrawal success screen' },
  { pattern: /withdraw\s+the\s+bonus\s+immediately/i, weight: 4, label: 'Urgency withdrawal prompt' },
  { pattern: /receive\s+usdt/i, weight: 3, label: 'USDT receipt claim' },
  { pattern: /\busdt\b/i, weight: 1, label: 'USDT mention' },
  { pattern: /\bbtc\s+wallet\b/i, weight: 2, label: 'BTC wallet mention' },
  { pattern: /\bcrypto\s+casino\b/i, weight: 3, label: 'Crypto casino mention' },
  { pattern: /cryptocurrency\s+casino/i, weight: 3, label: 'Cryptocurrency casino mention' },
  { pattern: /this\s+post\s+will\s+be\s+deleted/i, weight: 3, label: 'Disappearing post urgency' },
  { pattern: /offer\s+is\s+limited/i, weight: 2, label: 'Limited offer pressure' },
  { pattern: /only\s+the\s+fastest\s+people/i, weight: 3, label: 'Speed pressure tactic' },
  { pattern: /promotion\s+will\s+last\s+for\s+several\s+days/i, weight: 2, label: 'Short promotion window' },
  { pattern: /https?:\/\/[^\s]*\.(at|ru|cn|tk|ml|ga|cf|gq)[\s/]/i, weight: 2, label: 'Suspicious TLD in URL' },
  { pattern: /go\s+to\s*:\s*https?/i, weight: 2, label: 'Redirect instruction' },
  { pattern: /balance[\s:]+\$?[\d,]+(\.\d{2})?/i, weight: 1, label: 'Balance display' },
  { pattern: /bonus\s+balance/i, weight: 2, label: 'Bonus balance display' },
  { pattern: /vip.?club/i, weight: 1, label: 'VIP club reference' },
  { pattern: /click\s+(here|the\s+link)\s+to\s+(claim|receive|collect)/i, weight: 3, label: 'Click-to-claim link' },
  { pattern: /launch\s+of\s+my\s+own\s+.{0,20}\s+casino/i, weight: 4, label: 'Personal casino launch claim' },
];

const THRESHOLD = parseInt(process.env.SCAM_SCORE_THRESHOLD ?? '4', 10);

function normalise(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreText(text) {
  if (!text || !text.trim()) return { score: 0, reasons: [], triggered: false };

  const norm = normalise(text);
  let score = 0;
  const reasons = [];

  for (const signal of SIGNALS) {
    if (signal.pattern.test(norm)) {
      score += signal.weight;
      if (!reasons.includes(signal.label)) reasons.push(signal.label);
    }
  }

  return {
    score,
    reasons: reasons.slice(0, 6),
    triggered: score >= THRESHOLD,
  };
}

module.exports = { scoreText, SIGNALS, THRESHOLD };
