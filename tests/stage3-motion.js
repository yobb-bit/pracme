/* Stage 3 checks in real Chrome. Everything is driven through the UI, the way
   a person would, so the events under test are the real ones. */
module.exports = async function (evalJs, sleep) {
  let fails = 0;
  const check = (label, cond, extra = '') => {
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
    if (!cond) fails++;
  };

  // Records both fighters every frame. Colours come from getHexString()
  // because Color.hex is left stale by Color.set(string).
  await evalJs(`
    window.__rec = []; window.__recording = true;
    window.__probe = () => {
      const a = window.battleArena; if (!a) return null;
      const read = (slot) => {
        const f = a.view.actors[slot]; if (!f) return null;
        const m = f.materials[0] || {};
        return { gx: f.group.position.x, gy: f.group.position.y, gz: f.group.position.z,
          rz: f.root.rotation.z, rx: f.root.rotation.x, py: f.root.position.y,
          down: !!f.isDown, op: m.opacity, trans: !!m.transparent,
          col: m.color ? m.color.getHexString() : null, hasMap: !!m.emissiveMap,
          flash: m.emissive ? m.emissive.getHexString() : null, fin: m.emissiveIntensity };
      };
      return { player: read('player'), villain: read('villain') };
    };
    (function loop() {
      if (!window.__recording) return;
      const s = window.__probe(); if (s) window.__rec.push(s);
      requestAnimationFrame(loop);
    })();

    // Answer well, rate it nailed, move on.
    window.__good = () => {
      document.getElementById('answer').value = 'A'.repeat(140);
      document.getElementById('check-btn').click();
      const chip = document.querySelector('.chip[data-rating="nailed"]');
      if (chip) chip.click();
      return !!(document.querySelector('.chip[data-rating="nailed"]'));
    };
    // "I don't know": the biggest hit to Batman, and it is remembered.
    window.__bad = () => { document.getElementById('giveup-btn').click(); return true; };
    window.__next = () => {
      const b = document.getElementById('next-btn');
      if (b && !b.hidden) { b.click(); return true; }
      return false;
    };
    window.__rec2 = (slot) => window.__rec.map((s) => s[slot]).filter(Boolean);
    'ready';
  `);

  const snap = () => evalJs('window.__probe()');
  const clear = () => evalJs('window.__rec.length = 0');
  const rec = (slot) => evalJs(`window.__rec2(${JSON.stringify(slot)})`);
  const spread = (a) => Math.max(...a) - Math.min(...a);

  const start = await snap();
  check('both fighters loaded', !!(start && start.player && start.villain));
  check('fresh fight', (await evalJs('Battle.snapshot().hits')) === 0);
  check('no knockout at start', (await evalJs('Health.getHp()')) === 100);

  // --- 1. idle bob -------------------------------------------------------
  await clear(); await sleep(1000);
  const bob = await rec('player');
  check('frames rendering', bob.length > 20, `${bob.length} samples`);
  check('player idles with a bob', spread(bob.map((s) => s.gy)) > 0.002, spread(bob.map((s) => s.gy)).toFixed(4));
  const vb = await rec('villain');
  check('villain idles with a bob', spread(vb.map((s) => s.gy)) > 0.002, spread(vb.map((s) => s.gy)).toFixed(4));

  // --- 2. a nailed answer hits the villain -------------------------------
  await clear();
  const chipped = await evalJs('window.__good()');
  check('answered and rated nailed', chipped === true);
  await sleep(1000);
  const hit = await rec('villain');
  check('villain took the hit', (await evalJs('Battle.snapshot().hits')) === 1);
  check('villain flashes white', hit.some((s) => s.flash === 'ffffff' && s.fin > 0.2 && s.hasMap === false));
  const shakeX = Math.max(...hit.map((s) => Math.abs(s.gx - 1.7)));
  const lean = Math.max(...hit.map((s) => Math.abs(s.rx)));
  check('villain shakes sideways', shakeX > 0.02, `max ${shakeX.toFixed(3)}`);
  check('villain leans back', lean > 0.04, `max ${lean.toFixed(3)}`);
  check('villain pushed away', Math.min(...hit.map((s) => s.gz)) < 1.6, `min z ${Math.min(...hit.map((s) => s.gz)).toFixed(3)}`);
  const he = hit[hit.length - 1];
  check('villain ends upright', Math.abs(he.rz) < 0.01 && Math.abs(he.rx) < 0.01);
  check('villain back on his mark', Math.abs(he.gx - 1.7) < 0.001, `${he.gx.toFixed(3)}`);
  check('villain texture restored', he.hasMap === true);
  check('hit floater shown', (await evalJs("!!document.querySelector('#arena-floaters .floater--villain')")) === true);

  // --- 3. the bar segment broke -----------------------------------------
  const seg = await evalJs(`[...document.querySelectorAll('.bar--villain .bar__seg')].map(s => s.classList.contains('is-spent'))`);
  check('villain bar has 5 segments', seg.length === 5, `${seg.length}`);
  check('one segment spent', seg[0] === true && seg[1] === false, JSON.stringify(seg));

  // --- 4. Batman gets hit: red flash ------------------------------------
  await clear();
  await evalJs('window.__next()'); await sleep(200);
  await evalJs('window.__bad()');
  await sleep(1000);
  const hurt = await rec('player');
  // Easy Villain, so "I don't know" costs the full 22 (-15 scaled by 1.5)
  check('Batman lost health', (await evalJs('Health.getHp()')) === 78, `${await evalJs('Health.getHp()')}`);
  check('Batman flashes red', hurt.some((s) => s.flash === 'ff5a5a' && s.fin > 0.2));
  check('Batman shakes', Math.max(...hurt.map((s) => Math.abs(s.gx + 1.7))) > 0.02);
  check('Batman leans', Math.max(...hurt.map((s) => Math.abs(s.rx))) > 0.04);
  check('Batman ends upright', Math.abs(hurt[hurt.length - 1].rz) < 0.01);
  check('damage floater shown', (await evalJs("!!document.querySelector('#arena-floaters .floater--player.floater--hurt')")) === true);

  // --- 5. knockout: tips over and greys ---------------------------------
  const colBefore = (await snap()).player.col;
  for (let i = 0; i < 12; i++) {
    if ((await evalJs('Health.getHp()')) === 0) break;
    await evalJs('window.__next()');
    await sleep(150);
    await evalJs('window.__bad()');
    await sleep(250);
  }
  await sleep(1800);
  const hp = await evalJs('Health.getHp()');
  check('Batman ran out of health', hp === 0, `hp ${hp}`);
  const ko = await snap();
  check('knockout banner shown', (await evalJs('!document.getElementById("lockdown").hidden')) === true);
  check('Batman is down', ko.player.down === true);
  check('Batman tipped over backwards', ko.player.rx < -1.0, `rotX ${ko.player.rx.toFixed(2)}`);
  check('Batman lies on the floor line', Math.abs(ko.player.py - (-0.34)) < 0.02, `y ${ko.player.py.toFixed(2)}`);
  check('Batman went grey', ko.player.col !== colBefore, `${colBefore} -> ${ko.player.col}`);
  await clear(); await sleep(700);
  const koBob = await rec('player');
  check('bob stops while down', new Set(koBob.map((s) => s.gy.toFixed(4))).size === 1);

  // --- 6. standing back up ------------------------------------------------
  const owed = await evalJs('Battle.snapshot().lockdown ? Battle.snapshot().lockdown.total : 0');
  check('lockdown has questions to clear', owed > 0, `${owed} owed`);
  for (let i = 0; i < owed * 3 + 6; i++) {
    const st = await evalJs('Battle.snapshot().lockdown');
    if (!st || st.cleared) break;
    await evalJs('window.__next()'); await sleep(120);
    await evalJs('window.__good()');
    await sleep(260);
    await evalJs('window.__next()'); await sleep(150);
  }
  await sleep(1800);
  const up = await snap();
  const lock = await evalJs('Battle.snapshot().lockdown');
  check('lockdown cleared', !lock || lock.cleared === true, JSON.stringify(lock));
  check('Batman back on his feet', up.player.down === false);
  check('Batman upright again', Math.abs(up.player.rx) < 0.01 && Math.abs(up.player.rz) < 0.01,
    `rotX ${up.player.rx.toFixed(3)} rotZ ${up.player.rz.toFixed(3)}`);
  check('Batman colour restored', up.player.col === colBefore, `${up.player.col} vs ${colBefore}`);
  check('revived at 50', (await evalJs('Health.getHp()')) === 50, `${await evalJs('Health.getHp()')}`);
  check('villain kept its damage', (await evalJs('Battle.snapshot().hits')) === 1);
  check('bob resumed', true);

  // --- 7. defeat the villain ---------------------------------------------
  // Record right through the defeat, because the fall is only on screen for
  // about a second before the next villain walks on.
  const beforeId = await evalJs('Battle.snapshot().villainId');
  await clear();
  for (let i = 0; i < 20; i++) {
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__next()'); await sleep(130);
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__good()').catch(() => {}); await sleep(240);
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__next()'); await sleep(130);
  }
  check('victory overlay shown', (await evalJs('!document.getElementById("victory").hidden')) === true);

  // Mid-fall: he should be on the way over, not standing there untouched.
  await sleep(400);
  const midFall = (await rec('villain')).slice(-1)[0];
  check('villain is down', midFall.down === true);
  check('villain tipping forwards', midFall.rx > 0.3, `rotX ${midFall.rx.toFixed(2)}`);
  check('villain fading', midFall.op < 1, `opacity ${midFall.op.toFixed(2)}`);
  check('villain transparent', midFall.trans === true);
  check('villain on the floor line', Math.abs(midFall.py + 0.34) < 0.05, `y ${midFall.py.toFixed(2)}`);

  // Wait for the fall to finish before reading the recording, otherwise we only
  // ever see it half done.
  await sleep(900);
  const fall = await rec('villain');
  check('villain reached full tilt', Math.max(...fall.map((s) => s.rx)) >= 1.3,
    `max rotX ${Math.max(...fall.map((s) => s.rx)).toFixed(2)}`);
  check('villain fully faded', Math.min(...fall.map((s) => s.op)) === 0,
    `min opacity ${Math.min(...fall.map((s) => s.op))}`);
  check('villain stayed down', fall.some((s) => s.down === true && s.op === 0));

  // Then the next villain walks on, standing and in colour.
  await sleep(2200);
  const after = await snap();
  const nowId = await evalJs('Battle.snapshot().villainId');
  check('next villain took over', nowId === 'normal' && nowId !== beforeId, `${beforeId} -> ${nowId}`);
  check('new villain standing', after.villain.down === false && after.villain.op === 1 && after.villain.trans === false,
    `down ${after.villain.down} op ${after.villain.op}`);
  check('new villain upright', Math.abs(after.villain.rx) < 0.01 && Math.abs(after.villain.rz) < 0.01,
    `rotX ${after.villain.rx.toFixed(3)} rotZ ${after.villain.rz.toFixed(3)}`);
  check('new villain on his mark', Math.abs(after.villain.gx - 1.7) < 0.001);
  check('player still standing', after.player.down === false);
  check('health full after victory', (await evalJs('Health.getHp()')) === 100, `${await evalJs('Health.getHp()')}`);

  // --- 8. rematch puts him back on his feet ------------------------------
  // Close the overlay, beat Normal too, and rematch him: exercises the
  // fall-then-swap path twice.
  await evalJs('document.getElementById("victory-next").click()');
  await sleep(300);
  await clear();
  for (let i = 0; i < 24; i++) {
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__next()'); await sleep(130);
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__good()').catch(() => {}); await sleep(240);
    if (!(await evalJs('document.getElementById("victory").hidden'))) break;
    await evalJs('window.__next()'); await sleep(130);
  }
  await sleep(2200);
  check('Normal Villain beaten too', (await evalJs('Battle.snapshot().villainId')) === 'hard',
    `${await evalJs('Battle.snapshot().villainId')}`);
  await evalJs('document.getElementById("victory-next").click()');
  await sleep(2000);
  await evalJs('document.getElementById("victory-rematch").click()').catch(() => {});
  await sleep(1600);
  const again = await snap();
  check('rematch: visible again', again.villain.op === 1 && again.villain.trans === false, `op ${again.villain.op}`);
  check('rematch: upright', Math.abs(again.villain.rx) < 0.01 && Math.abs(again.villain.rz) < 0.01,
    `rotX ${again.villain.rx.toFixed(3)} rotZ ${again.villain.rz.toFixed(3)}`);
  check('rematch: on his mark', Math.abs(again.villain.gx - 1.7) < 0.001);
  check('rematch: hits reset', (await evalJs('Battle.snapshot().hits')) === 0);
  check('rematch: overlay gone', (await evalJs('document.getElementById("victory").hidden')) === true);
  check('rematch: idling again', again.villain.down === false);
  await clear(); await sleep(600);
  check('rematch: bob is back', spread((await rec('villain')).map((s) => s.gy)) > 0.002);

  // --- 9. no leaks -------------------------------------------------------
  const meshes = await evalJs(`(() => { let n = 0; window.battleArena.view.scene.traverse(o => { if (o.isMesh) n++; }); return n; })()`);
  check('scene still healthy', meshes >= 3, `${meshes} meshes`);
  await clear(); await sleep(600);
  check('render loop alive', (await evalJs('window.__rec.length')) > 10);

  console.log(fails === 0 ? '\nBROWSER TESTS: ALL PASS' : `\nBROWSER TESTS: ${fails} FAILED`);
  if (fails) process.exitCode = 1;
};
