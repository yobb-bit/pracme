/* `hidden` only works if no author rule sets `display` on the element -- an
   author rule beats the browser's built-in [hidden] { display: none }.
   This audits every element the JS toggles: does the property match reality? */
module.exports = async function (evalJs, sleep) {
  const send = global.send;

  const audit = () => evalJs(`(() => {
    const shown = (el) => {
      if (el.hidden) return false;
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden'
        && el.getClientRects().length > 0;
    };
    const out = [];
    for (const el of document.querySelectorAll('[id]')) {
      if (el.hidden && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0) {
        out.push({ id: el.id, want: 'hidden', got: 'visible',
                   display: getComputedStyle(el).display });
      }
    }
    return out;
  })()`);

  let bad = await audit();
  console.log(bad.length
    ? '  FAIL  hidden elements still painted:\n' +
      bad.map((b) => `          #${b.id}  hidden=true but display:${b.display}`).join('\n')
    : '  ok  every hidden element is actually hidden');

  // --- now the real user path: beat a villain, click the button -----------
  await evalJs(`
    window.__good = () => {
      document.getElementById('answer').value = 'A'.repeat(140);
      document.getElementById('check-btn').click();
      const chip = document.querySelector('.chip[data-rating="nailed"]');
      if (chip) chip.click(); return !!chip;
    };
    window.__next = () => { const b = document.getElementById('next-btn');
      if (b && !b.hidden) { b.click(); return true; } return false; };
    'ok';
  `);

  let beats = 0;
  for (let i = 0; i < 12 && beats < 5; i++) {
    if (beats > 0) {
      if (!(await evalJs('window.__next()'))) break;
      await sleep(140);
    }
    if (await evalJs('window.__good()')) { beats++; await sleep(300); }
  }
  console.log(`  ..  ${beats}/5 nails landed, ${await evalJs('Battle.snapshot().hits')} hits on the bar`);
  const shown = await evalJs('window.__probeVictory = !document.getElementById("victory").hidden');
  console.log(shown ? '  ok  victory panel opened' : '  FAIL  victory panel never opened');
  await sleep(400);

  // A real mouse click at the button's centre, not element.click().
  const box = await evalJs(`(() => {
    const r = document.getElementById('victory-next').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height,
             label: document.getElementById('victory-next').textContent };
  })()`);
  console.log(`  ..  button reads "${box.label}" at ${Math.round(box.w)}x${Math.round(box.h)}`);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', {
      type, x: box.x, y: box.y, button: 'left', clickCount: 1,
    });
  }
  await sleep(600);

  const after = await evalJs(`(() => {
    const el = document.getElementById('victory');
    const cs = getComputedStyle(el);
    return { hiddenProp: el.hidden, display: cs.display, painted: el.getClientRects().length > 0 };
  })()`);
  const gone = after.hiddenProp && after.display === 'none' && !after.painted;
  console.log(gone
    ? '  ok  clicking "Next villain" really closes the panel'
    : `  FAIL  click did nothing: hidden=${after.hiddenProp} display=${after.display} painted=${after.painted}`);

  // The next villain should already be standing there behind the panel.
  const v = await evalJs(`(() => {
    const s = window.battleArena.view;
    return { name: document.getElementById('arena-villain-name').textContent,
             model: !!s.actors.villain.root.children.length, op: s.actors.villain.opacity,
             btn: document.getElementById('check-btn').disabled };
  })()`);
  console.log(`  ..  after the click: villain "${v.name}", model loaded=${v.model}, opacity ${v.op}`);
  console.log(`  ..  quiz interactive=${!v.btn}`);

  // --- the two other casualties, judged by what is really on screen -------
  const real = (id) => evalJs(`(() => {
    const el = document.getElementById(${JSON.stringify(id)});
    const cs = getComputedStyle(el);
    return { hidden: el.hidden, display: cs.display,
             painted: el.getClientRects().length > 0 && cs.display !== 'none' };
  })()`);
  const check = (label, cond, extra = '') =>
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);

  const loading = await real('arena-loading');
  check('loading overlay gone once the scene is up',
    !loading.painted, `display:${loading.display}`);

  const diffBoss = await real('difficulties');
  check('difficulty chips not shown during a boss fight',
    !diffBoss.painted, `display:${diffBoss.display}`);

  await evalJs('Battle.setMode("practice")'); await sleep(500);
  const diffPractice = await real('difficulties');
  check('difficulty chips ARE shown in Free Practice', diffPractice.painted,
    `display:${diffPractice.display}`);

  const fallback = await real('arena-fallback');
  check('WebGL fallback box not covering a working scene', !fallback.painted,
    `display:${fallback.display}`);

  await evalJs('Battle.setMode("boss")'); await sleep(400);
};
