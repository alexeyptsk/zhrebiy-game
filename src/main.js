// Точка входа: загружаем данные из data/*.json, запускаем Phaser и интерфейс.
import { World } from './world.js';
import { Game } from './game.js';
import * as ui from './ui.js';
import * as audio from './audio.js';

const files = ['comedies', 'hints', 'scenes', 'cards', 'hotspots', 'map'];

function fit() {
  const st = document.getElementById('stage');
  const h = st.getBoundingClientRect().height || window.innerHeight;
  st.style.setProperty('--base', Math.max(12, Math.min(21, h * 0.039)) + 'px');
  const portrait = window.innerHeight > window.innerWidth && matchMedia('(pointer:coarse)').matches;
  document.getElementById('rotate').hidden = !portrait;
}
window.addEventListener('resize', fit); window.addEventListener('orientationchange', fit);

async function boot() {
  fit();
  let D;
  try {
    const arr = await Promise.all(files.map(f => fetch(`data/${f}.json`).then(r => { if (!r.ok) throw new Error(f); return r.json() })));
    D = Object.fromEntries(files.map((f, i) => [f, arr[i]]));
  } catch (e) {
    document.getElementById('loadingText').textContent = 'Не удалось загрузить игру. Обновите страницу.'; return;
  }
  const world = new World(D);
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: 'game', width: 1920, height: 1080, backgroundColor: '#0f0c09',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    render: { antialias: true, roundPixels: false }, scene: [world]
  });
  world.on('ready', () => {
    document.getElementById('loading').hidden = true;
    const g = new Game(world, D); g.bindWorld(); window.__game = g;
    ui.icons({
      onMenu: () => { if (confirmPause()) { } },
      onHints: () => g.showHints(),
      onSound: on => { audio.start(); audio.setEnabled(on) },
      onFull: () => { const s = document.getElementById('stage'); if (document.fullscreenElement) document.exitFullscreen?.(); else s.requestFullscreen?.().catch(() => ui.notice('Полный экран здесь недоступен.')) }
    });
    function confirmPause() {
      g.paused = true;
      const box = document.createElement('div'); box.className = 'plaque center'; box.style.zIndex = 6;
      box.innerHTML = `<div class="body"><div class="over">Пауза</div><h2>Жребий</h2><p class="soft">Прогресс сохраняется в этом браузере после каждого этапа.</p></div><div class="acts"><button class="btn primary">Продолжить</button><button class="btn">Начать заново</button></div>`;
      const [b1, b2] = box.querySelectorAll('button');
      b1.onclick = () => { box.remove(); g.paused = false };
      b2.onclick = () => { g.clearSave(); location.reload() };
      document.getElementById('ui').appendChild(box); return true;
    }
    g.menu();
  });
}
boot();
