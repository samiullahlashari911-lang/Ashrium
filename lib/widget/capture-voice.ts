/**
 * Spoken capture guidance with the phone's built-in voice (Web Speech API, no
 * package). The phone is propped a few metres away, too far to read the chip.
 * Mute is a per-device preference.
 *
 * Browser quirks handled here: Chrome drops an utterance spoken in the same
 * tick as `cancel()`, and can leave the queue paused; an utterance that is not
 * referenced can be garbage-collected before it ends (no sound); voices load
 * late, so an English voice is picked again when they arrive; iOS speaks only
 * after a first utterance inside a tap, and plays it quietly unless a media
 * element was started in that tap (`primeCaptureVoice`).
 */
const MUTE_KEY = 'ashrium.capture.voiceMuted';
/** An unresolved instruction is repeated this often. */
const REPEAT_MS = 7000;
/** A changed instruction is spoken at once, unless it is the line just said. */
const FORCED_REPEAT_MS = 2500;
/** Gap between `cancel()` and the next `speak()` (Chrome drops a same-tick speak). */
const AFTER_CANCEL_MS = 60;
const LANG = 'en-US';
/** 50 ms of silence (8 kHz mono WAV): starting it inside the tap opens iOS audio playback. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA';

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

export function captureVoiceSupported(): boolean {
  return synth() !== null;
}

export function readVoiceMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeVoiceMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // Private mode: the toggle still works for this capture.
  }
}

/** A local English voice when the device has one; null lets the browser choose by `lang`. */
export function pickEnglishVoice(voices: readonly SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const english = voices.filter((voice) => voice.lang.toLowerCase().replace('_', '-').startsWith('en'));
  const rank = (voice: SpeechSynthesisVoice): number =>
    (voice.lang.toLowerCase().replace('_', '-') === 'en-us' ? 2 : 0) + (voice.localService ? 1 : 0);
  return [...english].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

let englishVoice: SpeechSynthesisVoice | null = null;
let voicesWatched = false;

function refreshVoice(): void {
  const speech = synth();
  if (speech) {
    englishVoice = pickEnglishVoice(speech.getVoices());
  }
}

function watchVoices(): void {
  const speech = synth();
  if (!speech || voicesWatched) {
    return;
  }
  voicesWatched = true;
  refreshVoice();
  speech.addEventListener?.('voiceschanged', refreshVoice);
}

/** Utterances in flight, held so the browser cannot collect them mid-sentence. */
const speaking = new Set<SpeechSynthesisUtterance>();

function speakNow(text: string, onDone?: () => void): void {
  const speech = synth();
  if (!speech) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = englishVoice?.lang ?? LANG;
  if (englishVoice) {
    utterance.voice = englishVoice;
  }
  utterance.rate = 1;
  utterance.volume = 1;
  const release = (): void => {
    speaking.delete(utterance);
    onDone?.();
  };
  utterance.onend = release;
  utterance.onerror = release;
  speaking.add(utterance);
  speech.resume();
  speech.speak(utterance);
}

/**
 * Call from the tap that opens the camera: iOS speaks only after a first
 * utterance inside a gesture, and a media element started there lets the
 * voice play at full volume.
 */
export function primeCaptureVoice(): void {
  const speech = synth();
  if (!speech || readVoiceMuted()) {
    return;
  }
  watchVoices();
  try {
    const audio = new Audio(SILENT_WAV);
    audio.setAttribute('playsinline', '');
    void audio.play().catch(() => undefined);
  } catch {
    // No media element: speech still works where the browser allows it.
  }
  const utterance = new SpeechSynthesisUtterance(' ');
  utterance.volume = 0;
  utterance.lang = LANG;
  speech.speak(utterance);
}

/** Longest an instruction can hold off the live cues if the browser never reports its end. */
const INTRO_MS_PER_CHAR = 85;

export class CaptureVoice {
  private lastText = '';
  private lastAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Until then a step's instructions are playing and live cues wait. */
  private introUntil = 0;
  muted = false;

  /** A step's spoken instructions: interrupt whatever is playing, then hold off cues until said. */
  intro(text: string): void {
    this.introUntil = 0;
    this.say(text, true);
    if (this.lastText === text) {
      this.introUntil = Date.now() + Math.max(2500, text.length * INTRO_MS_PER_CHAR);
    }
  }

  /** A result the shopper must hear ("Got it", a retake reason): interrupts even the instructions. */
  announce(text: string): void {
    this.introUntil = 0;
    this.say(text, true);
  }

  /** Speaks `text` unless it was just said; `force` interrupts and says it now. */
  say(text: string, force = false): void {
    const speech = synth();
    if (!speech || this.muted) {
      return;
    }
    watchVoices();
    const now = Date.now();
    if (now < this.introUntil) {
      return;
    }
    // "Hold still" is both the green cue and the movement cue: never say a line twice back to back.
    const sinceSame = text === this.lastText ? now - this.lastAt : Infinity;
    if (sinceSame < (force ? FORCED_REPEAT_MS : REPEAT_MS)) {
      return;
    }
    // A routine repeat waits for the current sentence instead of cutting it off.
    if (!force && speech.speaking) {
      return;
    }
    this.lastText = text;
    this.lastAt = now;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (speech.speaking || speech.pending) {
      speech.cancel();
      this.timer = setTimeout(() => {
        this.timer = null;
        if (!this.muted) {
          speakNow(text, () => this.finished(text));
        }
      }, AFTER_CANCEL_MS);
      return;
    }
    speakNow(text, () => this.finished(text));
  }

  private finished(text: string): void {
    if (text === this.lastText) {
      this.introUntil = 0;
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    synth()?.cancel();
    this.lastText = '';
    this.introUntil = 0;
  }
}
