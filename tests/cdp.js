/* Stage 3 browser test: samples the real 3D transforms over time while the
   fight plays out, in a real headless Chrome with WebGL. */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const HERE = __dirname;
const SUITE = path.basename(process.env.CASES || 'stage3-motion.js');

// A stale profile would carry last run's localStorage into this one, so the
// fight would start halfway through. Start from nothing every time.
for (const dir of [path.join(HERE, '.chrome-profile'), path.join(HERE, '.chrome-profile-reduced')]) {
  fs.rmSync(dir, { recursive: true, force: true });
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9344;
const URL = process.env.APP_URL || 'http://127.0.0.1:8765/quiz.html';
const args = process.argv.slice(2);
const REDUCED = args.includes('--reduced-motion');
const MOBILE = args.includes('--mobile');

const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=' + PORT,
  '--use-gl=angle',
  '--enable-unsafe-swiftshader',
  '--hide-scrollbars',
  '--user-data-dir=' + path.join(HERE, REDUCED ? '.chrome-profile-reduced' : '.chrome-profile'),
  ...(REDUCED ? ['--force-prefers-reduced-motion'] : []),
  'about:blank',
], { stdIO: 'ignore', stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, msgId = 0;
const pending = new Map();
const logs = [];

async function main() {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/version`); if (r.ok) break; } catch {}
    await sleep(250);
  }
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  ws.addEventListener('message', (event) => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      logs.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '));
    if (m.method === 'Runtime.exceptionThrown')
      logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });
  const send = (method, params = {}) => new Promise((res) => {
    const id = ++msgId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise });
    if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
    return r.result?.result?.value;
  };

  await send('Runtime.enable');
  await send('Page.enable');

  // Device size has to be set before the page loads, because the renderer
  // reads window.devicePixelRatio once when it is built.
  if (MOBILE) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 3, mobile: true,
    });
  }

  // The command line flag is ignored in headless, so ask the renderer directly.
  if (REDUCED) {
    await send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  }
  await send('Page.navigate', { url: URL });
  await sleep(3000);
  // Start from clean fight data with the feature-page guard satisfied.
  await send('Runtime.evaluate', { expression: `localStorage.clear(); localStorage.setItem('drill:profile', JSON.stringify({version:1,onboardingComplete:true,hero:{id:'batman',name:'Batman'},topics:[],unlockedHeroes:['batman'],heroesUsed:[],guideSeen:true}))` });
  await send('Page.reload', { ignoreCache: true });
  await sleep(4500);

  global.send = send; global.evalJs = evalJs; global.sleep = sleep;
  console.log(`\n=== ${SUITE}${REDUCED ? ' (reduced motion)' : ''}${MOBILE ? ' (phone, dark)' : ''} ===`);
  await require(path.join(HERE, SUITE))(evalJs, sleep);

  console.log('\n--- console errors/warnings ---');
  console.log(logs.length ? logs.join('\n') : '(none)');
  ws.close(); chrome.kill();
  process.exit(0);
}
main().catch((e) => { console.error('HARNESS ERROR', e); try { ws.close(); } catch {} chrome.kill(); process.exit(1); });
