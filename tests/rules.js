/* Regression tests for the fight rules that the Stage 3 work had to touch:
   - you cannot hit the villain while you are knocked out
   - only "Nailed it" clears the homework
   - a second knock-down does not compound the grey
   - undo still works, and Free Practice still means no fight */
module.exports = async function (evalJs, sleep) {
  let fails = 0;
  const check = (label, cond, extra = '') => {
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
    if (!cond) fails++;
  };

  await evalJs(`
    window.__good = () => {
      document.getElementById('answer').value = 'A'.repeat(140);
      document.getElementById('check-btn').click();
      const chip = document.querySelector('.chip[data-rating="nailed"]');
      if (chip) chip.click(); return !!chip;
    };
    window.__rate = (r) => {
      document.getElementById('answer').value = 'A'.repeat(140);
      document.getElementById('check-btn').click();
      const chip = document.querySelector('.chip[data-rating="' + r + '"]');
      if (chip) chip.click(); return !!chip;
    };
    window.__bad = () => { document.getElementById('giveup-btn').click(); return true; };
    window.__next = () => { const b = document.getElementById('next-btn');
      if (b && !b.hidden) { b.click(); return true; } return false; };
    window.__col = (slot) => { const f = window.battleArena.view.actors[slot];
      return f.materials[0].color.getHexString(); };
    'ok';
  `);
  const lock = () => evalJs('Battle.snapshot().lockdown');

  // --- knock him out ----------------------------------------------------
  for (let i = 0; i < 12; i++) {
    if ((await evalJs('Health.getHp()')) === 0) break;
    await evalJs('window.__next()'); await sleep(120);
    await evalJs('window.__bad()'); await sleep(200);
  }
  check('knocked out', (await evalJs('Health.getHp()')) === 0);
  const owed = (await lock()).total;
  const hitsAtKo = (await evalJs('Battle.snapshot().hits'));
  check('lockdown has homework', owed > 0, `${owed}`);

  // --- "Partly" must NOT clear the homework ------------------------------
  await evalJs('window.__next()'); await sleep(150);
  await evalJs('window.__rate("partly")');
  await sleep(300);
  let st = await lock();
  check('Partly does not clear the list', st.done === 0 && st.cleared === false, JSON.stringify(st));
  check('still knocked out', (await evalJs('Health.getHp()')) === 0, `${await evalJs('Health.getHp()')}`);
  check('Partly does not hit the villain', (await evalJs('Battle.snapshot().hits')) === hitsAtKo);
  check('banner still up', (await evalJs('!document.getElementById("lockdown").hidden')) === true);
  await evalJs('window.__next()'); await sleep(200);

  // --- "Nailed it" does ---------------------------------------------------
  await evalJs('window.__good()');
  await sleep(300);
  st = await lock();
  check('Nailed it clears one', st.done === 1, JSON.stringify(st));
  check('still no villain damage while down', (await evalJs('Battle.snapshot().hits')) === hitsAtKo,
    `${await evalJs('Battle.snapshot().hits')} vs ${hitsAtKo}`);
  check('health stays at 0 until it is all cleared', (await evalJs('Health.getHp()')) === 0);
  await evalJs('window.__next()'); await sleep(200);

  // --- finish it ----------------------------------------------------------
  for (let i = 0; i < 24; i++) {
    st = await lock();
    if (!st || st.cleared) break;
    await evalJs('window.__next()'); await sleep(120);
    await evalJs('window.__good()'); await sleep(240);
    await evalJs('window.__next()'); await sleep(130);
  }
  st = await lock();
  check('homework cleared', !st || st.cleared === true, JSON.stringify(st));
  check('back up on 50', (await evalJs('Health.getHp()')) === 50, `${await evalJs('Health.getHp()')}`);
  check('villain kept every hit', (await evalJs('Battle.snapshot().hits')) === hitsAtKo);
  const grey1 = await evalJs('window.__col("player")');
  check('colour fully restored', grey1 === 'ffffff', grey1);

  // --- a second knock-down must not compound the grey ---------------------
  for (let i = 0; i < 14; i++) {
    if ((await evalJs('Health.getHp()')) === 0) break;
    await evalJs('window.__next()'); await sleep(120);
    await evalJs('window.__bad()'); await sleep(200);
  }
  await sleep(800);
  check('knocked out again', (await evalJs('Health.getHp()')) === 0);
  const grey2 = await evalJs('window.__col("player")');
  check('grey is the same shade, not darker', grey2 === 'a2a5ac', `${grey1} then ${grey2}`);
  for (let i = 0; i < 24; i++) {
    st = await lock();
    if (!st || st.cleared) break;
    await evalJs('window.__next()'); await sleep(120);
    await evalJs('window.__good()'); await sleep(240);
    await evalJs('window.__next()'); await sleep(130);
  }
  await sleep(600);
  check('colour restored again', (await evalJs('window.__col("player")')) === 'ffffff',
    await evalJs('window.__col("player")'));

  // --- undo still works ---------------------------------------------------
  await evalJs('window.__next()'); await sleep(200);
  const hpBefore = await evalJs('Health.getHp()');
  await evalJs('window.__bad()');
  await sleep(300);
  check('a give-up costs health', (await evalJs('Health.getHp()')) < hpBefore,
    `${hpBefore} -> ${await evalJs('Health.getHp()')}`);
  check('undo button offered', (await evalJs('!document.getElementById("undo-btn").hidden')) === true);
  await evalJs('document.getElementById("undo-btn").click()');
  await sleep(300);
  check('undo hands the health back', (await evalJs('Health.getHp()')) === hpBefore,
    `${await evalJs('Health.getHp()')} vs ${hpBefore}`);
  check('undo button gone again', (await evalJs('document.getElementById("undo-btn").hidden')) === true);

  // --- Free Practice means no fight --------------------------------------
  const hitsBefore = await evalJs('Battle.snapshot().hits');
  await evalJs('Battle.setMode("practice")');
  await sleep(400);
  check('boss panel hidden', (await evalJs('document.getElementById("boss-panel").hidden')) === true);
  await evalJs('window.__next()'); await sleep(200);
  await evalJs('window.__good()');
  await sleep(300);
  check('no villain damage in Free Practice', (await evalJs('Battle.snapshot().hits')) === hitsBefore);
  check('no health change in Free Practice', (await evalJs('Health.getHp()')) === hpBefore,
    `${await evalJs('Health.getHp()')}`);
  await evalJs('Battle.setMode("boss")');
  await sleep(400);
  check('back in the fight', (await evalJs('document.getElementById("boss-panel").hidden')) === false);
  check('filters came back', (await evalJs('!document.getElementById("difficulties").hidden')) === false);

  console.log(fails === 0 ? '\nRULES TESTS: ALL PASS' : `\nRULES TESTS: ${fails} FAILED`);
  if (fails) process.exitCode = 1;
};
