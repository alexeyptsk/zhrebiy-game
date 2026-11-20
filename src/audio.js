// Звук без файлов: шум зала, смех, шёпот — синтез WebAudio. Громкость зависит от расстояния (затухание по радиусу).
// Когда команда пришлёт записи, их можно положить в assets/audio и подменить здесь.
let ctx = null, master = null, crowd = null, crowdGain = null, enabled = true;

function noiseBuffer(sec = 2) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate); const d = b.getChannelData(0);
  let last = 0; for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5 }
  return b;
}
export function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return }
  try { ctx = new (window.AudioContext || window.webkitAudioContext)() } catch { return }
  master = ctx.createGain(); master.gain.value = enabled ? 0.6 : 0; master.connect(ctx.destination);
  crowd = ctx.createBufferSource(); crowd.buffer = noiseBuffer(3); crowd.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 520; bp.Q.value = 0.7;
  crowdGain = ctx.createGain(); crowdGain.gain.value = 0;
  crowd.connect(bp).connect(crowdGain).connect(master); crowd.start();
}
export function setEnabled(on) { enabled = on; if (master) master.gain.setTargetAtTime(on ? 0.6 : 0, ctx.currentTime, 0.1) }
/** Гул зала: d — расстояние до центра театра (в пикселях исходника), r — радиус затухания. */
export function crowdAt(d, r = 350, base = 0.35) {
  if (!ctx) return; const g = Math.max(0, 1 - d / r) * base + 0.02;
  crowdGain.gain.setTargetAtTime(g, ctx.currentTime, 0.4);
}
/** Взрыв смеха или аплодисменты. strength 0..1, vol — с учётом расстояния. */
export function laugh(strength = 1, vol = 1) {
  if (!ctx || !enabled) return; const t = ctx.currentTime;
  for (let i = 0; i < 3 + Math.round(strength * 5); i++) {
    const s = ctx.createBufferSource(); s.buffer = noiseBuffer(0.6);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + Math.random() * 900; f.Q.value = 3;
    const g = ctx.createGain(); const st = t + i * 0.12 + Math.random() * 0.1;
    g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(0.25 * strength * vol, st + 0.05); g.gain.exponentialRampToValueAtTime(0.001, st + 0.5);
    s.connect(f).connect(g).connect(master); s.start(st); s.stop(st + 0.6);
  }
}
/** Короткий звук интерфейса: тук таблички, щелчок. */
export function tick(freq = 220, dur = 0.08) {
  if (!ctx || !enabled) return; const o = ctx.createOscillator(); const g = ctx.createGain();
  o.type = 'triangle'; o.frequency.value = freq; g.gain.value = 0.15; g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(master); o.start(); o.stop(ctx.currentTime + dur);
}
