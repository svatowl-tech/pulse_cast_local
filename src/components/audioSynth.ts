import type { StudioAudioMixer } from '../types/stream.ts';

// Автономный Web Audio API синтезатор для локального саундборда и алертов
let sharedAudioCtx: AudioContext | null = null;

export function getAlertsVolumeMultiplier(mixer?: StudioAudioMixer): number {
  if (!mixer) return 1;
  if (mixer.master_muted || mixer.alerts_muted) return 0;
  return (mixer.master_volume / 100) * (mixer.alerts_volume / 100);
}

export function playSynthTone(
  freqHz: number,
  pattern: string,
  volume: number,
  mixer?: StudioAudioMixer,
): void {
  try {
    const effectiveVol = volume * getAlertsVolumeMultiplier(mixer);
    if (effectiveVol <= 0.001) return;

    const AudioContextClass =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioContextClass();
    if (sharedAudioCtx.state === 'suspended') {
      void sharedAudioCtx.resume();
    }

    const now = sharedAudioCtx.currentTime;
    const notes =
      pattern === 'fanfare'
        ? [freqHz, freqHz * 1.25, freqHz * 1.5, freqHz * 2]
        : pattern === 'arpeggio'
          ? [freqHz, freqHz * 1.5]
          : pattern === 'boom'
            ? [freqHz, freqHz * 0.5]
            : [freqHz];

    notes.forEach((f, idx) => {
      if (!sharedAudioCtx) return;
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = pattern === 'boom' ? 'sawtooth' : 'triangle';
      osc.frequency.setValueAtTime(f, now + idx * 0.08);
      gain.gain.setValueAtTime(Math.max(0.01, Math.min(1, effectiveVol * 0.25)), now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.28);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.3);
    });
  } catch {
    // Игнорируем ограничения автовоспроизведения до первого клика пользователя
  }
}

export function speakTts(text: string, mixer?: StudioAudioMixer): void {
  try {
    if (!('speechSynthesis' in window) || !text.trim()) return;
    if (mixer && (mixer.master_muted || mixer.tts_muted)) return;
    const volume = mixer ? (mixer.master_volume / 100) * (mixer.tts_volume / 100) : 1;
    if (volume <= 0.01) return;

    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ru-RU';
    utter.volume = Math.max(0, Math.min(1, volume));
    utter.rate = mixer?.tts_rate ?? 1.02;
    utter.pitch = mixer?.tts_pitch ?? 1.0;
    window.speechSynthesis.speak(utter);
  } catch {
    // Web Speech TTS опционален
  }
}
