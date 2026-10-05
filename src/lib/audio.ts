/**
 * Small browser-only alert sounds. No audio files: tones are synthesised so the
 * PWA stays tiny and works offline.
 */

import jingleAsset from "@/assets/twende-driver-alert.mp3.asset.json";

type Tone = "offer" | "status" | "arrived";

let jingle: HTMLAudioElement | null = null;

const patterns: Record<Tone, { freq: number; at: number; length: number }[]> = {
  offer: [
    { freq: 880, at: 0, length: 0.16 },
    { freq: 1320, at: 0.18, length: 0.2 },
    { freq: 880, at: 0.42, length: 0.16 },
    { freq: 1320, at: 0.6, length: 0.26 },
  ],
  status: [
    { freq: 660, at: 0, length: 0.14 },
    { freq: 990, at: 0.16, length: 0.2 },
  ],
  arrived: [
    { freq: 1046, at: 0, length: 0.18 },
    { freq: 784, at: 0.2, length: 0.18 },
    { freq: 1046, at: 0.4, length: 0.3 },
  ],
};

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === "suspended") void context.resume();
  return context;
}

/** Browsers only allow sound after a gesture — call this once on first tap. */
export function primeAudio() {
  audioContext();
  if (typeof window === "undefined") return;
  if (!jingle) {
    jingle = new Audio(jingleAsset.url);
    jingle.preload = "auto";
  }
  // Unlock playback on this gesture so later offers can ring without a tap.
  jingle.muted = true;
  void jingle
    .play()
    .then(() => {
      jingle?.pause();
      if (jingle) {
        jingle.currentTime = 0;
        jingle.muted = false;
      }
    })
    .catch(() => {
      if (jingle) jingle.muted = false;
    });
}

/** Reads a notification aloud (voice alert) after the chime. */
export function speak(text: string, delayMs = 900) {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return;
  window.setTimeout(() => {
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.slice(0, 200));
      u.lang = "en-GB";
      u.rate = 1;
      u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch {
      // voice is a bonus; the chime and banner still show
    }
  }, delayMs);
}

/** Chime + voice for an incoming push. */
export function announce(tone: Tone, title: string, body: string) {
  playAlert(tone);
  speak(body ? `${title}. ${body}` : title);
}

/** Stops the ride-offer jingle (offer accepted, declined, or expired). */
export function stopAlert() {
  if (!jingle) return;
  jingle.pause();
  jingle.currentTime = 0;
}

export function playAlert(tone: Tone = "status") {
  // Ride offers use the branded jingle; other events keep the short synth tones.
  if (tone === "offer" && typeof window !== "undefined") {
    try {
      if (!jingle) {
        jingle = new Audio(jingleAsset.url);
        jingle.preload = "auto";
      }
      jingle.currentTime = 0;
      void jingle.play().catch(() => undefined);
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate([200, 120, 200, 120, 300]);
      }
      return;
    } catch {
      // fall through to the synthesised tone
    }
  }
  const ctx = audioContext();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const note of patterns[tone]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = note.freq;
    gain.gain.setValueAtTime(0.0001, now + note.at);
    gain.gain.exponentialRampToValueAtTime(0.25, now + note.at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + note.at);
    osc.stop(now + note.at + note.length + 0.02);
  }
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(tone === "offer" ? [120, 80, 120] : 80);
  }
}
