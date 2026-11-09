const test = require('node:test');
const assert = require('node:assert');
const { classifyWatchHtml, checkLive } = require('../src/services/youtubeLive');

const ID = 'abcDEF12345';
const watchPage = details =>
  `<html><script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"OK"},` +
  `"videoDetails":{"videoId":"${ID}","title":"Litas \\"live\\"",${details}},"microformat":{"x":1}};</script></html>`;

test('gyva transliacija', () => {
  assert.deepStrictEqual(classifyWatchHtml(watchPage('"isLive":true,"isLiveContent":true')), {
    status: 'live',
    videoId: ID,
    title: 'Litas "live"',
  });
});

test('suplanuota transliacija nėra live, net jei kitur puslapyje "isLive":true', () => {
  const html = watchPage('"isUpcoming":true,"isLiveContent":true') + '{"isLive":true}';
  assert.strictEqual(classifyWatchHtml(html).status, 'upcoming');
});

test('pasibaigusi transliacija', () => {
  assert.strictEqual(classifyWatchHtml(watchPage('"isLiveContent":true')).status, 'ended');
});

test('paprastas video', () => {
  assert.strictEqual(classifyWatchHtml(watchPage('"isLiveContent":false')).status, 'video');
});

test('/live nukreipė į kanalo puslapį → nėra transliacijos', () => {
  const html = '<link rel="canonical" href="https://www.youtube.com/channel/UCxyz"><div>"isLive":true</div>';
  assert.deepStrictEqual(classifyWatchHtml(html), { status: 'none' });
});

test('consent / netikėtas puslapis → unknown', () => {
  assert.strictEqual(classifyWatchHtml('<html>x</html>', 'https://consent.youtube.com/m').status, 'unknown');
  assert.strictEqual(classifyWatchHtml('<html>captcha</html>').status, 'unknown');
});

// Struktūra kaip tikrame YouTube atsakyme (įdėtas commandMetadata prieš watchEndpoint).
const botPage = extra =>
  `{"playabilityStatus":{"status":"LOGIN_REQUIRED"}} {"currentVideoEndpoint":{"clickTrackingParams":"x",` +
  `"commandMetadata":{"webCommandMetadata":{"url":"/watch?v=${ID}","rootVe":3832}},` +
  `"watchEndpoint":{"videoId":"${ID}"}}} "browseId":"UCxyz" ${extra}`;

test('robotų patikra: atsarginis variantas', () => {
  assert.strictEqual(classifyWatchHtml(botPage('"upcomingEventData":{}')).status, 'upcoming');
  assert.deepStrictEqual(
    classifyWatchHtml(botPage(
      '"playerOverlayVideoDetailsRenderer":{"title":{"simpleText":"Litas live"}} "isLive":true ' +
      '"dateText":{"simpleText":"Started streaming 2 hours ago"}'
    )),
    { status: 'live', videoId: ID, title: 'Litas live' }
  );
  assert.strictEqual(classifyWatchHtml(botPage('"dateText":{"simpleText":"Streamed live on Nov 1, 2026"}')).status, 'ended');
  assert.strictEqual(classifyWatchHtml(botPage('"dateText":{"simpleText":"Premiered Nov 1, 2026"}')).status, 'ended');
  assert.strictEqual(classifyWatchHtml(botPage('"dateText":{"simpleText":"Nov 1, 2026"}')).status, 'video');
  assert.strictEqual(classifyWatchHtml(botPage('')).status, 'unknown');
});

test('robotų patikra kanalo puslapyje (tik browseId) → unknown, ne video', () => {
  const html = '{"playabilityStatus":{"status":"LOGIN_REQUIRED"}} "browseId":"UCxyz"';
  assert.strictEqual(classifyWatchHtml(html).status, 'unknown');
});

test('checkLive niekada nemeta klaidos', async () => {
  const boom = async () => { throw new Error('network down'); };
  assert.strictEqual((await checkLive('UCxyz', boom)).status, 'unknown');
  const r429 = async () => ({ ok: false, status: 429 });
  assert.deepStrictEqual(await checkLive('UCxyz', r429), { status: 'unknown', reason: 'http_429' });
  const ok = async () => ({ ok: true, url: 'https://www.youtube.com/watch?v=' + ID, text: async () => watchPage('"isLive":true') });
  assert.strictEqual((await checkLive('UCxyz', ok)).status, 'live');
});
