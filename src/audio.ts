/**
 * A few synthesised sounds on Web Audio: no files. The context is made on
 * the first touch, as iOS wants. `play(name)` is what the game loop calls
 * for every name the sim pushed onto state.sounds.
 */
let ctx: AudioContext | null = null;
let muted = false;

export function unlock(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    ctx = new AudioContext();
  } catch {
    ctx = null;
  }
}

export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slide = 0, at = 0): void {
  if (!ctx || muted) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const t0 = ctx.currentTime + at;
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export function play(name: string): void {
  switch (name) {
    case 'pay':
      tone(880, 0.09, 'square', 0.08);
      tone(1320, 0.14, 'square', 0.08, 0, 0.08);
      break;
    case 'build':
      tone(220, 0.12, 'triangle', 0.12, -60);
      tone(330, 0.1, 'triangle', 0.1, 0, 0.1);
      break;
    case 'undo':
      tone(330, 0.1, 'triangle', 0.1, -120);
      break;
    case 'buy':
      tone(440, 0.08, 'square', 0.07);
      tone(660, 0.12, 'square', 0.07, 0, 0.07);
      break;
    case 'whistle':
      tone(1046, 0.35, 'sine', 0.06, 60);
      tone(1318, 0.35, 'sine', 0.04, 60);
      break;
    case 'load':
      tone(180, 0.06, 'triangle', 0.06);
      break;
    case 'bell':
      tone(1760, 0.5, 'sine', 0.08, -20);
      tone(2217, 0.6, 'sine', 0.04, -20, 0.12);
      break;
    case 'win':
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 'square', 0.07, 0, i * 0.14));
      break;
    case 'lose':
      [392, 349, 311].forEach((f, i) => tone(f, 0.3, 'triangle', 0.08, 0, i * 0.22));
      break;
  }
}
