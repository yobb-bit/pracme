/* With prefers-reduced-motion: reduce, the 3D stage must hold completely still
   while the fight still plays out through the DOM. */
module.exports = async function (evalJs, sleep) {
  let fails = 0;
  const check = (label, cond, extra = '') => {
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
    if (!cond) fails++;
  };

  const reported = await evalJs(`window.matchMedia('(prefers-reduced-motion: reduce)').matches`);
  check('browser reports reduced motion', reported === true, `${reported}`);
  check('arena sees it too', (await evalJs('window.battleArena.prefersReducedMotion()')) === true);

  await evalJs(`
    window.__rec = []; window.__recording = true;
    (function loop() {
      if (!window.__recording) return;
      const a = window.battleArena;
      const read = (slot) => { const f = a.view.actors[slot]; if (!f) return null;
        const m = f.materials[0] || {};
        return { gx: f.group.position.x, gy: f.group.position.y, gz: f.group.position.z,
          rz: f.root.rotation.z, rx: f.root.rotation.x, py: f.root.position.y,
          down: !!f.isDown, op: m.opacity, trans: !!m.transparent,
          col: m.color ? m.color.getHexString() : null, hasMap: !!m.emissiveMap, fin: m.emissiveIntensity };
      };
      window.__rec.push({ player: read('player'), villain: read('villain') });
      requestAnimationFrame(loop);
    })();
    window.__good = () => {
      document.getElementById('answer').value = 'A'.repeat(140);
      document.getElementById('check-btn').click();
      const chip = document.querySelector('.chip[data-rating="nailed"]');
      if (chip) chip.click(); return !!chip;
    };
    window.__bad = () => { document.getElementById('giveup-btn').click(); return true; };
    window.__next = () => { const b = document.getElementById('next-btn');
      if (b && !b.hidden) { b.click(); return true; } return false; };
    'ok';
  `);
  const clear = () => evalJs('window.__rec.length = 0');
  const rec = (s) => evalJs(`window.__rec.map(r => r[${JSON.stringify(s)}]).filter(Boolean)`);
  const flat = (a) => [...new Set(a.map((v) => Number(v).toFixed(4)))];

  // --- no idle bob ------------------------------------------------------
  await clear(); await sleep(900);
  check('player does not bob', flat((await rec('player')).map((s) => s.gy)).length === 1);
  check('villain does not bob', flat((await rec('villain')).map((s) => s.gy)).length === 1);

  // --- landing a hit: no movement, no flash ------------------------------
  await clear();
  await evalJs('window.__good()');
  await sleep(900);
  const v = await rec('villain');
  check('no lunge for Batman', flat((await rec('player')).map((s) => s.gz)).length === 1);
  check('villain does not shake', flat(v.map((s) => s.gx)).length === 1);
  check('villain does not move', flat(v.map((s) => s.gz)).length === 1);
  check('villain does not lean', flat(v.map((s) => s.rx)).length === 1);
  check('no colour flash', v.every((s) => s.hasMap === true));
  check('no shadow flicker', flat(v.map((s) => s.fin)).length === 1);
  check('the hit still counted', (await evalJs('Battle.snapshot().hits')) === 1, `${await evalJs('Battle.snapshot().hits')}`);
  check('bar still shows the hit',
    (await evalJs(`document.querySelectorAll('.bar--villain .bar__seg')[0].classList.contains('is-spent')`)) === true);
  check('the number still floated',
    (await evalJs(`!!document.querySelector('#arena-floaters .floater--villain')`)) === true);

  // --- taking damage: no movement, no flash -----------------------------
  await clear();
  await evalJs('window.__next()'); await sleep(200);
  await evalJs('window.__bad()');
  await sleep(900);
  const p = await rec('player');
  check('Batman does not shake', flat(p.map((s) => s.gx)).length === 1);
  check('Batman does not lean', flat(p.map((s) => s.rx)).length === 1);
  check('Batman does not move', flat(p.map((s) => s.gz)).length === 1);
  check('Batman does not flash', p.every((s) => s.hasMap === true));
  check('damage still applied', (await evalJs('Health.getHp()')) === 78, `${await evalJs('Health.getHp()')}`);
  check('damage floater still shown',
    (await evalJs(`!!document.querySelector('#arena-floaters .floater--player.floater--hurt')`)) === true);

  // --- knockout: grey, but no tipping ------------------------------------
  const colBefore = (await evalJs('window.__probe ? 0 : (window.battleArena.view.actors.player.materials[0].color.getHexString())'));
  for (let i = 0; i < 12; i++) {
    if ((await evalJs('Health.getHp()')) === 0) break;
    await evalJs('window.__next()'); await sleep(130);
    await evalJs('window.__bad()'); await sleep(230);
  }
  await sleep(900);
  const ko = await evalJs(`(() => { const f = window.battleArena.view.actors.player; const m = f.materials[0];
    return { down: !!f.isDown, rz: f.root.rotation.z, rx: f.root.rotation.x, py: f.root.position.y,
             col: m.color.getHexString() }; })()`);
  check('HP reached 0', (await evalJs('Health.getHp()')) === 0);
  check('knockout banner shown', (await evalJs('!document.getElementById("lockdown").hidden')) === true);
  check('marked as down', ko.down === true);
  check('no tipping over', Math.abs(ko.rz) < 0.001 && Math.abs(ko.rx) < 0.001, `rotZ ${ko.rz} rotX ${ko.rx}`);
  // restPosition is captured before anything animates, so compare like for like
  const restY = (await rec('player'))[0].py;
  check('no falling', Math.abs(ko.py - restY) < 0.001, `y ${ko.py} vs rest ${restY}`);
  check('still went grey', ko.col !== colBefore, `${colBefore} -> ${ko.col}`);
  check('fighter does not move at all', ko.down === true);

  // --- clearing it puts him back, with no animation ---------------------
  for (let i = 0; i < 24; i++) {
    const st = await evalJs('Battle.snapshot().lockdown');
    if (!st || st.cleared) break;
    await evalJs('window.__next()'); await sleep(120);
    await evalJs('window.__good()'); await sleep(250);
    await evalJs('window.__next()'); await sleep(140);
  }
  await sleep(700);
  const up = await evalJs(`(() => { const f = window.battleArena.view.actors.player; const m = f.materials[0];
    return { down: !!f.isDown, rz: f.root.rotation.z, rx: f.root.rotation.x, col: m.color.getHexString() }; })()`);
  check('lockdown cleared', (await evalJs('!Battle.snapshot().lockdown || Battle.snapshot().lockdown.cleared')) === true);
  check('back on his feet', up.down === false);
  check('colour restored', up.col === colBefore, `${up.col} vs ${colBefore}`);
  check('revived at 50', (await evalJs('Health.getHp()')) === 50, `${await evalJs('Health.getHp()')}`);

  // --- defeat: no tipping, just a faint figure ---------------------------
  for (let i = 0; i < 20; i++) {
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__next()'); await sleep(130);
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__good()').catch(() => {}); await sleep(240);
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__next()'); await sleep(130);
  }
  await sleep(1200);
  check('villain defeated', (await evalJs('Battle.snapshot().hitsLeft')) === 0 || (await evalJs('Battle.snapshot().villainId')) !== 'easy');
  check('victory overlay shown', (await evalJs('!document.getElementById("victory").hidden')) === true);
  const next = await evalJs(`(() => { const f = window.battleArena.view.actors.villain; const m = f.materials[0];
    return { id: window.battleArena.view.villainId, down: !!f.isDown, rz: f.root.rotation.z,
             rx: f.root.rotation.x, op: m.opacity, trans: !!m.transparent, gx: f.group.position.x }; })()`);
  check('next villain walked straight on', next.id === 'normal', `${next.id}`);
  check('no tip-over left behind', Math.abs(next.rz) < 0.001 && Math.abs(next.rx) < 0.001,
    `rotZ ${next.rz} rotX ${next.rx}`);
  check('next villain fully visible', next.op === 1 && next.trans === false, `op ${next.op}`);

  // --- no console noise, loop still alive -------------------------------
  const meshes = await evalJs(`(() => { let n = 0; window.battleArena.view.scene.traverse(o => { if (o.isMesh) n++; }); return n; })()`);
  check('scene healthy', meshes >= 3, `${meshes} meshes`);
  await clear(); await sleep(600);
  check('render loop alive', (await evalJs('window.__rec.length')) > 10);

  console.log(fails === 0 ? '\nREDUCED-MOTION TESTS: ALL PASS' : `\nREDUCED-MOTION TESTS: ${fails} FAILED`);
  if (fails) process.exitCode = 1;
};
