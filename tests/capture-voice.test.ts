import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';

import { CaptureVoice, pickEnglishVoice } from '@/lib/widget/capture-voice';

interface FakeUtterance {
  text: string;
  lang: string;
  onend: (() => void) | null;
}

function installSpeech(): { spoken: string[]; cancels: number; finish: () => void; speaking: boolean } {
  const state = { spoken: [] as string[], cancels: 0, speaking: false, current: null as FakeUtterance | null };
  const speech = {
    get speaking() {
      return state.speaking;
    },
    pending: false,
    getVoices: () => [],
    addEventListener: () => undefined,
    resume: () => undefined,
    cancel: () => {
      state.cancels += 1;
      state.speaking = false;
    },
    speak: (utterance: FakeUtterance) => {
      state.spoken.push(utterance.text);
      state.speaking = true;
      state.current = utterance;
    },
  };
  Object.assign(globalThis, {
    window: { speechSynthesis: speech },
    SpeechSynthesisUtterance: class {
      text: string;
      lang = '';
      onend: (() => void) | null = null;
      constructor(text: string) {
        this.text = text;
      }
    },
  });
  return {
    get spoken() {
      return state.spoken;
    },
    get cancels() {
      return state.cancels;
    },
    get speaking() {
      return state.speaking;
    },
    finish: () => {
      state.speaking = false;
      state.current?.onend?.();
    },
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
});

test('an English voice is preferred, US and on-device first', () => {
  const voice = (lang: string, localService: boolean) => ({ lang, localService }) as SpeechSynthesisVoice;
  assert.equal(pickEnglishVoice([voice('fr-FR', true), voice('en-GB', false), voice('en-US', true)])?.lang, 'en-US');
  assert.equal(pickEnglishVoice([voice('de-DE', true), voice('en_IN', false)])?.lang, 'en_IN');
  assert.equal(pickEnglishVoice([voice('de-DE', true)]), null);
});

test('live cues wait until the step instructions have been said', () => {
  const speech = installSpeech();
  const voice = new CaptureVoice();
  voice.intro('Front photo. Step back.');
  assert.deepEqual(speech.spoken, ['Front photo. Step back.']);

  voice.say('Step back', true);
  assert.deepEqual(speech.spoken, ['Front photo. Step back.'], 'a cue must not cut the intro off');

  speech.finish();
  voice.say('Step back', true);
  assert.deepEqual(speech.spoken, ['Front photo. Step back.', 'Step back']);
});

test('"Got it" is never swallowed by instructions still playing', async () => {
  const speech = installSpeech();
  const voice = new CaptureVoice();
  voice.intro('Side photo. Turn to your side.');
  voice.announce('Got it. Building your fitting.');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(speech.spoken, ['Side photo. Turn to your side.', 'Got it. Building your fitting.']);
});

test('an interrupting line is spoken a tick after cancel, and a routine repeat never interrupts', async () => {
  const speech = installSpeech();
  const voice = new CaptureVoice();
  voice.say('Step back');
  voice.say('Move left');
  assert.deepEqual(speech.spoken, ['Step back'], 'a routine line waits for the current one');

  voice.say('Hold still', true);
  assert.equal(speech.cancels, 1);
  assert.deepEqual(speech.spoken, ['Step back'], 'speaking in the same tick as cancel is dropped by Chrome');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.deepEqual(speech.spoken, ['Step back', 'Hold still']);
});
