// YouTube live / video tipo nustatymas iš HTML (be API rakto).
// Statusai: 'live' | 'upcoming' | 'ended' (pasibaigusi transliacija / premjera) | 'video' | 'none' | 'unknown'.

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // Praleidžia ES consent puslapį.
  Cookie: 'SOCS=CAI; CONSENT=YES+1',
};

function unescapeJsonString(s) {
  try {
    return JSON.parse(`"${s}"`);
  } catch {
    return s;
  }
}

function unknown(reason) {
  return { status: 'unknown', reason };
}

// Tik videoDetails blokas: kitur puslapyje "isLive":true būna ir suplanuotoms transliacijoms.
function classifyFromVideoDetails(html) {
  const start = html.indexOf('"videoDetails":{');
  if (start === -1) return null;
  const end = html.indexOf('},"microformat":', start);
  if (end === -1) return null;
  const block = html.slice(start, end);

  const videoId = block.match(/"videoId":"([\w-]{11})"/)?.[1];
  if (!videoId) return null;
  const title = unescapeJsonString(block.match(/"title":"((?:[^"\\]|\\.)*)"/)?.[1] || '');

  let status = 'video';
  if (/"isUpcoming":true/.test(block)) status = 'upcoming';
  else if (/"isLive":true/.test(block)) status = 'live';
  else if (/"isLiveContent":true/.test(block)) status = 'ended';
  return { status, videoId, title };
}

// Atsarginis variantas robotų patikrai (LOGIN_REQUIRED): žiūrim į ytInitialData.
// Kanalo puslapio pagal browseId NEatpažįstam — jis yra ir video puslapyje.
function classifyFromInitialData(html) {
  // Tarp jų yra įdėtas commandMetadata objektas, todėl [^}] netinka.
  const videoId = html.match(/"currentVideoEndpoint":\{.{0,1000}?"watchEndpoint":\{"videoId":"([\w-]{11})"/)?.[1];
  if (!videoId) return unknown('bot_check');
  const title = unescapeJsonString(
    html.match(/"playerOverlayVideoDetailsRenderer":\{"title":\{"simpleText":"((?:[^"\\]|\\.)*)"/)?.[1] ||
      html.match(/"videoPrimaryInfoRenderer":\{"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.)*)"/)?.[1] ||
      ''
  );

  if (html.includes('"upcomingEventData"')) return { status: 'upcoming', videoId, title };
  if (/"isLive":true/.test(html)) return { status: 'live', videoId, title };
  const dateText = html.match(/"dateText":\{"simpleText":"((?:[^"\\]|\\.)*)"/)?.[1];
  if (dateText == null) return unknown('bot_check');
  if (/stream|premier|live/i.test(dateText)) return { status: 'ended', videoId, title };
  return { status: 'video', videoId, title };
}

function classifyWatchHtml(html, finalUrl = '') {
  if (typeof html !== 'string' || !html) return unknown('empty');
  if (/consent\.(youtube|google)\.com/.test(finalUrl)) return unknown('consent');

  if (/"playabilityStatus":\{"status":"LOGIN_REQUIRED"/.test(html)) {
    return classifyFromInitialData(html);
  }

  const fromDetails = classifyFromVideoDetails(html);
  if (fromDetails) return fromDetails;

  // /live nukreipė į kanalo puslapį → transliacijos nėra.
  if (/<link rel="canonical" href="https:\/\/www\.youtube\.com\/(channel\/|@)/.test(html)) {
    return { status: 'none' };
  }

  return unknown('unexpected_page');
}

async function fetchAndClassify(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return unknown(`http_${res.status}`);
    return classifyWatchHtml(await res.text(), res.url || '');
  } catch (e) {
    return unknown(String(e?.message || e).slice(0, 200));
  }
}

/** Niekada nemeta klaidos. */
function checkLive(ytChannelId, fetchImpl) {
  return fetchAndClassify(`https://www.youtube.com/channel/${ytChannelId}/live`, fetchImpl);
}

/** Niekada nemeta klaidos. */
function checkVideoKind(videoId, fetchImpl) {
  return fetchAndClassify(`https://www.youtube.com/watch?v=${videoId}`, fetchImpl);
}

module.exports = { classifyWatchHtml, checkLive, checkVideoKind };
