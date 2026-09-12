const path = require('path');
const fs = require('fs');

const JAIL_JSON_PATH = path.join(__dirname, '../../jail.json');

let cachedQuestions = null;

function getJailQuestions() {
  if (cachedQuestions) return cachedQuestions;
  try {
    if (fs.existsSync(JAIL_JSON_PATH)) {
      const raw = fs.readFileSync(JAIL_JSON_PATH, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) {
        cachedQuestions = data;
        return cachedQuestions;
      }
    }
  } catch (err) {
    console.error('[jailQuestions] Klaida skaitant jail.json:', err?.message || err);
  }
  return [];
}

function normalizeAnswer(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/ą/g, 'a')
    .replace(/č/g, 'c')
    .replace(/ę/g, 'e')
    .replace(/ė/g, 'e')
    .replace(/į/g, 'i')
    .replace(/š/g, 's')
    .replace(/ų/g, 'u')
    .replace(/ū/g, 'u')
    .replace(/ž/g, 'z')
    .replace(/[^\w\s\d]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isAnswerCorrect(userInput, acceptedAnswers) {
  const userNorm = normalizeAnswer(userInput);
  if (!userNorm) return false;
  const userWords = userNorm.split(' ');

  for (const ans of acceptedAnswers) {
    const ansNorm = normalizeAnswer(ans);
    if (!ansNorm) continue;
    if (userNorm === ansNorm) return true;
    if (ansNorm.includes(' ') && userNorm.includes(ansNorm)) return true;
    if (!ansNorm.includes(' ') && userWords.includes(ansNorm)) return true;
  }
  return false;
}

function shuffleArray(arr) {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickRandomQuestions(count = 5) {
  const all = getJailQuestions();
  if (!all.length) return [];

  const targetCount = Math.max(1, parseInt(count, 10) || 5);

  // Jei klausimų skaičius neviršija bendro kiekio – atrenkame visiškai unikalius atsitiktine tvarka
  if (targetCount <= all.length) {
    const shuffled = shuffleArray(all);
    return shuffled.slice(0, targetCount);
  }

  // Jei viršija – kartojame klausimus atsitiktiniais ciklais, vengiant dviejų vienodų iš eilės
  const result = [];
  while (result.length < targetCount) {
    const deck = shuffleArray(all);
    if (result.length > 0 && deck.length > 1 && result[result.length - 1]?.id === deck[0]?.id) {
      [deck[0], deck[1]] = [deck[1], deck[0]];
    }
    const needed = targetCount - result.length;
    result.push(...deck.slice(0, needed));
  }

  return result;
}

module.exports = {
  getJailQuestions,
  normalizeAnswer,
  isAnswerCorrect,
  pickRandomQuestions,
};
