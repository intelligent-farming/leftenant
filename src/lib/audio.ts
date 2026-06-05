// Tiny Web Audio beeper for field-tech feedback. Keep the operator looking
// at the device, not the screen — a short tone is enough confirmation.
//
// One shared AudioContext, lazily created. Browsers require a user gesture
// before audio can play, so the first beep after page load may be silent on
// some platforms — that's a browser policy, not a bug.

let ctx: AudioContext | undefined;

const getContext = (): AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!Ctor) return undefined;
    ctx = new Ctor();
  }
  return ctx;
};

const beep = (freq: number, durationMs: number, gain = 0.08): void => {
  const c = getContext();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.connect(g);
  g.connect(c.destination);
  osc.type = 'sine';
  osc.frequency.value = freq;
  const now = c.currentTime;
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
  osc.start(now);
  osc.stop(now + durationMs / 1000);
};

/** Short high tone — used on successful submission. */
export const beepSuccess = (): void => beep(880, 80);

/** Two-tone descending chirp — used on failed submission. */
export const beepError = (): void => {
  beep(440, 80);
  setTimeout(() => beep(220, 120), 90);
};

/** Soft click — used on QR detection (pre-submit). */
export const beepScan = (): void => beep(1320, 35, 0.04);
