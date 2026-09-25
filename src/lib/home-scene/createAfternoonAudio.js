// Original, locally synthesized ambient loop. Nothing plays before a user click.
export function createAfternoonAudio() {
  const context = new AudioContext();
  const output = context.createGain();
  output.gain.value = .32;
  const filter = context.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 2400;
  const delay = context.createDelay(2);
  delay.delayTime.value = .56;
  const feedback = context.createGain();
  feedback.gain.value = .24;
  filter.connect(output);
  filter.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  feedback.connect(output);
  output.connect(context.destination);
  const chords = [[48,55,59,64], [45,52,55,60], [41,48,52,57], [43,50,55,59]];
  let timer, next = context.currentTime + .08, step = 0, disposed = false;
  function note(midi, when, duration, gain) {
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0, when);
    envelope.gain.linearRampToValueAtTime(gain, when + .035);
    envelope.gain.exponentialRampToValueAtTime(.0001, when + duration);
    envelope.connect(filter);
    const tone = context.createOscillator();
    tone.type = "sine";
    tone.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    tone.connect(envelope);
    tone.start(when);
    tone.stop(when + duration + .02);
    tone.onended = () => { tone.disconnect(); envelope.disconnect(); };
  }
  function schedule() {
    if (disposed || context.state !== "running") return;
    while (next < context.currentTime + .3) {
      const chord = chords[Math.floor(step / 16) % chords.length];
      const index = [0,2,1,3,2,1,3,2][step % 8];
      note(chord[index] + 12, next, 2.7, step % 2 ? .075 : .11);
      if (step % 16 === 0) chord.slice(0,3).forEach(n => note(n, next, 5.8, .045));
      next += .46;
      step++;
    }
  }
  return {
    async play() {
      await context.resume();
      if (disposed) return;
      if (next < context.currentTime) next = context.currentTime + .04;
      schedule();
      clearInterval(timer);
      timer = setInterval(schedule, 100);
    },
    async pause() { clearInterval(timer); await context.suspend(); },
    volume(value) { output.gain.setTargetAtTime(value * .8, context.currentTime, .03); },
    dispose() { disposed = true; clearInterval(timer); void context.close(); },
  };
}
