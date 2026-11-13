// @ts-check
// A soft chime when an agent finishes a turn (model/lamps.js finishedAgents): two notes rising, made by the browser's
// audio — no file to load. A browser lets a page sound only once its reader has done something on it: the audio wakes
// at the first press of a key, a pointer or a finger, and wakes again at the next one should the browser have put it to
// sleep — a phone's page put away and back.

/** The notes — E5, then B5 a little after it — their pitch, Hz, and when each starts, s. */
const notes = [
  { hz: 659.25, at: 0 },
  { hz: 987.77, at: 0.11 },
];
/** How loud a note is at its peak, of the full scale, and how long it rings, s. */
const peak = 0.16;
const ringS = 0.55;

/**
 * @param {Pick<Document, 'addEventListener'>} page — whose presses wake the audio
 * @returns {{ play: () => void }} — play: the chime, if the audio is awake; nothing before the reader did anything
 */
export function createChime(page) {
  /** @type {{ context: AudioContext | undefined }} */
  const audio = { context: undefined };
  const wake = () => {
    if (audio.context === undefined) audio.context = new AudioContext();
    if (audio.context.state === 'suspended') void audio.context.resume();
  };
  for (const press of /** @type {const} */ (['pointerdown', 'keydown', 'touchend'])) page.addEventListener(press, wake, { passive: true });
  return {
    play() {
      const context = audio.context;
      if (context === undefined || context.state !== 'running') return;
      const start = context.currentTime;
      for (const { hz, at } of notes) {
        const tone = context.createOscillator();
        tone.type = 'sine';
        tone.frequency.value = hz;
        const loudness = context.createGain();
        // a quick rise and a long fall: a bell's, not a beep's
        loudness.gain.setValueAtTime(0, start + at);
        loudness.gain.linearRampToValueAtTime(peak, start + at + 0.012);
        loudness.gain.exponentialRampToValueAtTime(0.0001, start + at + ringS);
        tone.connect(loudness).connect(context.destination);
        tone.start(start + at);
        tone.stop(start + at + ringS + 0.05);
      }
    },
  };
}
