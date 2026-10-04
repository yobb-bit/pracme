/* A phone-sized window: the fighters must stay in frame, and the knock-downs
   must not push them off the edge. */
module.exports = async function (evalJs, sleep) {
  let fails = 0;
  const check = (label, cond, extra = '') => {
    console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
    if (!cond) fails++;
  };

  const send = global.send;
  // Size and colour scheme were applied by the harness before the page loaded.
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: 'dark' }],
  });
  await evalJs('window.dispatchEvent(new Event("resize"))');
  await sleep(1200);

  await evalJs(`
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

  const view = await evalJs(`(() => {
    const v = window.battleArena.view;
    v.camera.updateProjectionMatrix();
    const canvas = v.renderer.domElement;
    const project = (x, y, z) => {
      const p = new (v.scene.constructor === Object ? Object : Object)();
      return null;
    };
    return { w: canvas.clientWidth, h: canvas.clientHeight, camZ: v.camera.position.z,
             fov: v.camera.fov, aspect: v.camera.aspect, dpr: v.renderer.getPixelRatio(),
             bg: '#' + v.scene.background.getHexString(),
             player: !!v.actors.player, villain: !!v.actors.villain };
  })()`);
  check('phone-sized canvas', view.w <= 400 && view.h > 0, `${view.w}x${view.h}`);
  check('DPR capped at 2', view.dpr === 2, `${view.dpr}`);
  // The arena panel is wider than tall even on a phone, so the camera stays put.
  check('camera framed for this aspect', view.camZ >= 7.2, `z ${view.camZ} aspect ${view.aspect.toFixed(2)}`);
  const lum = parseInt(view.bg.slice(1), 16);
  check('dark background in use', lum < 0x303030, `${view.bg} (dark)`);
  check('both fighters present', view.player && view.villain);

  // Where does a fighter's head land on screen once he is down? Project the
  // real bounding box of the tipped-over model.
  const bounds = async (slot) => evalJs(`(() => {
    const a = window.battleArena;
    const f = a.view.actors[${JSON.stringify(slot)}];
    const box = new (Object.getPrototypeOf(f.group).constructor === Object ? Object : Object)();
    return null;
  })()`);
  void bounds;

  // Knock Batman out and confirm he is still within the frame.
  for (let i = 0; i < 12; i++) {
    if ((await evalJs('Health.getHp()')) === 0) break;
    await evalJs('window.__next()'); await sleep(130);
    await evalJs('window.__bad()'); await sleep(210);
  }
  await sleep(900);
  const ko = await evalJs('window.__probe ? 0 : (() => { const f = window.battleArena.view.actors.player; return f.root.rotation.x; })()');
  check('Batman down on a phone too', Math.abs(ko) > 1.0, `rotX ${ko.toFixed(2)}`);

  // The project bounding box of every mesh, in normalised device coordinates:
  // anything past +/-1 is off screen.
  const offscreen = await evalJs(`(() => {
    const a = window.battleArena;
    let worst = 0, who = '';
    for (const slot of ['player', 'villain']) {
      const f = a.view.actors[slot];
      f.root.updateWorldMatrix(true, true);
      f.root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        for (const cx of [bb.min.x, bb.max.x]) for (const cy of [bb.min.y, bb.max.y]) for (const cz of [bb.min.z, bb.max.z]) {
          const v = { x: cx, y: cy, z: cz };
          const m = o.matrixWorld.elements;
          const wx = m[0]*v.x + m[4]*v.y + m[8]*v.z + m[12];
          const wy = m[1]*v.x + m[5]*v.y + m[9]*v.z + m[13];
          const wz = m[2]*v.x + m[6]*v.y + m[10]*v.z + m[14];
          const p = new a.view.camera.position.constructor(wx, wy, wz);
          p.project(a.view.camera);
          const d = Math.max(Math.abs(p.x), Math.abs(p.y));
          if (d > worst) { worst = d; who = slot; }
        }
      });
    }
    return { worst, who };
  })()`);
  check('everything stays on screen', offscreen.worst < 1.0,
    `worst ${offscreen.worst.toFixed(3)} (${offscreen.who}), limit 1.0`);

  const px = await evalJs(`window.battleArena.view.renderer.domElement.width`);
  const css = await evalJs(`window.battleArena.view.renderer.domElement.clientWidth`);
  check('backing store scaled for DPR', px === css * view.dpr, `${px}px for ${css}css at dpr ${view.dpr}`);

  await send('Emulation.clearDeviceMetricsOverride');
  process.exitCode = fails === 0 ? 0 : 1;
  console.log(fails === 0 ? '\nPHONE TESTS: ALL PASS' : `\nPHONE TESTS: ${fails} FAILED`);
};
