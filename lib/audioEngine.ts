import * as Tone from "tone";
import {
  getPitchForX,
  getInstrumentForY,
  getVelocityForNoteIndex,
  getDurationForInstrument,
  getPanForX,
  type Instrument,
} from "./musicMapping";
import type { NoteEvent } from "./eventListener";

export class DriftAudioEngine {
  private initialized = false;
  private reverb!: Tone.Reverb;
  private delay!: Tone.PingPongDelay;
  private compressor!: Tone.Compressor;
  private reverbChannel!: Tone.Channel;
  private delayChannel!: Tone.Channel;
  private masterChannel!: Tone.Channel;

  private padSynth!: Tone.PolySynth;
  private pluckSynth!: Tone.PluckSynth;
  private pianoSynth!: Tone.PolySynth;
  private bellSynth!: Tone.PolySynth;
  private bassSynth!: Tone.MonoSynth;
  private ambientDrone!: Tone.PolySynth;

  private panner!: Tone.Panner;

  async initialize() {
    if (this.initialized) return;
    await Tone.start();

    // Effects chain
    this.compressor = new Tone.Compressor({
      threshold: -20,
      ratio: 4,
      attack: 0.003,
      release: 0.25,
    }).toDestination();

    this.reverb = new Tone.Reverb({
      decay: 6,
      wet: 0.4,
    }).connect(this.compressor);

    this.delay = new Tone.PingPongDelay({
      delayTime: "8n",
      feedback: 0.3,
      wet: 0.25,
    }).connect(this.reverb);

    // Channel routing
    this.reverbChannel = new Tone.Channel({ volume: -6 }).connect(this.reverb);
    this.delayChannel = new Tone.Channel({ volume: -8 }).connect(this.delay);
    this.masterChannel = new Tone.Channel({ volume: -4 }).connect(this.compressor);
    this.panner = new Tone.Panner(0).connect(this.reverbChannel);

    // Pad Synth — ethereal, sustained
    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.8, decay: 1.0, sustain: 0.6, release: 2.0 },
      volume: -8,
    }).connect(this.reverbChannel);

    // Pluck Synth — harp-like
    this.pluckSynth = new Tone.PluckSynth({
      attackNoise: 1,
      dampening: 4000,
      resonance: 0.95,
      volume: -6,
    }).connect(this.delayChannel);

    // Piano — FM synthesis
    this.pianoSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 1,
      envelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 1.0 },
      volume: -6,
    }).connect(this.reverbChannel);

    // Bell — metallic, use FMSynth since MetalSynth doesn't work well with PolySynth
    this.bellSynth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 5.1,
      modulationIndex: 32,
      envelope: { attack: 0.001, decay: 0.4, sustain: 0.1, release: 2.0 },
      volume: -10,
    }).connect(this.delayChannel);

    // Sub Bass — deep, warm
    this.bassSynth = new Tone.MonoSynth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 1.5 },
      filterEnvelope: {
        attack: 0.06,
        decay: 0.2,
        sustain: 0.5,
        release: 2,
        baseFrequency: 200,
        octaves: 2,
      },
      volume: -4,
    }).connect(this.masterChannel);

    // Ambient drone
    this.ambientDrone = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 2, decay: 0, sustain: 1, release: 2 },
      volume: -24,
    }).connect(this.reverb);

    this.initialized = true;
  }

  startAmbientDrone() {
    if (!this.initialized) return;
    this.ambientDrone.triggerAttack(["C2", "G2"]);
  }

  playNote(event: NoteEvent) {
    if (!this.initialized) return;

    const pitch = getPitchForX(event.x);
    const instrument = getInstrumentForY(event.y);
    const velocity = getVelocityForNoteIndex(event.noteIndex);
    const duration = getDurationForInstrument(instrument);
    const pan = getPanForX(event.x);

    // Set panner position
    this.panner.pan.value = pan;

    const synth = this.getSynthForInstrument(instrument);
    try {
      if (instrument === "BASS") {
        (synth as Tone.MonoSynth).triggerAttackRelease(
          pitch, duration, Tone.now(), velocity
        );
      } else if (instrument === "PLUCK") {
        (synth as Tone.PluckSynth).triggerAttackRelease(pitch, Tone.now());
      } else {
        (synth as Tone.PolySynth).triggerAttackRelease(
          pitch, duration, Tone.now(), velocity
        );
      }
    } catch (e) {
      // Gracefully handle polyphony overflow
      console.warn("Audio overflow:", e);
    }
  }

  private getSynthForInstrument(instrument: Instrument) {
    switch (instrument) {
      case "PAD": return this.padSynth;
      case "PLUCK": return this.pluckSynth;
      case "PIANO": return this.pianoSynth;
      case "BELL": return this.bellSynth;
      case "BASS": return this.bassSynth;
    }
  }

  dispose() {
    if (!this.initialized) return;
    try {
      this.ambientDrone?.releaseAll();
      this.padSynth?.dispose();
      this.pluckSynth?.dispose();
      this.pianoSynth?.dispose();
      this.bellSynth?.dispose();
      this.bassSynth?.dispose();
      this.ambientDrone?.dispose();
      this.reverb?.dispose();
      this.delay?.dispose();
      this.compressor?.dispose();
      this.reverbChannel?.dispose();
      this.delayChannel?.dispose();
      this.masterChannel?.dispose();
      this.panner?.dispose();
    } catch {
      // Cleanup errors are non-critical
    }
  }
}
