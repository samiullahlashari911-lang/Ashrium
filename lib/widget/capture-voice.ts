/**
 * Spoken capture guidance with the phone's built-in voice (Web Speech API, no
 * package). The phone is propped a few metres away, too far to read the chip.
 * Mute is a per-device preference.
 */
const MUTE_KEY = 'ashrium.capture.voiceMuted';
/** An unresolved instruction is repeated this often. */
const REPEAT_MS = 7000;
/** A changed instruction is spoken at once, unless it is the line just said. */
const FORCED_REPEAT_MS = 2500;

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

/** iOS speaks only after a first utterance inside a tap; call from the tap that opens the camera. */
export function primeCaptureVoice(): void {
  const speech = synth();
  if (!speech || readVoiceMuted()) {
    return;
  }
  const utterance = new SpeechSynthesisUtterance(' ');
  utterance.volume = 0;
  speech.speak(utterance);
}

export class CaptureVoice {
  private lastText = '';
  private lastAt = 0;
  muted = false;

  /** Speaks `text` unless it was just said; `force` interrupts and says it now. */
  say(text: string, force = false): void {
    const speech = synth();
    if (!speech || this.muted) {
      return;
    }
    const now = Date.now();
    // "Hold still" is both the green cue and the movement cue: never say a line twice back to back.
    const sinceSame = text === this.lastText ? now - this.lastAt : Infinity;
    if (sinceSame < (force ? FORCED_REPEAT_MS : REPEAT_MS)) {
      return;
    }
    this.lastText = text;
    this.lastAt = now;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    speech.speak(utterance);
  }

  stop(): void {
    synth()?.cancel();
    this.lastText = '';
  }
}
