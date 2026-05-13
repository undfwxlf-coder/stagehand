declare module "soundtouchjs" {
  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number);
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    percentagePlayed: number;
    duration: number;
    formattedDuration: string;
    formattedTimePlayed: string;
    on(event: string, cb: (data: { timePlayed: number; percentagePlayed: number }) => void): void;
    connect(node: AudioNode): void;
    disconnect(): void;
  }
  export class SoundTouch {
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
  }
  export class SimpleFilter {
    constructor(source: unknown, pipe: SoundTouch);
  }
  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
  }
  export class RateTransposer {
    rate: number;
  }
  export class Stretch {
    tempo: number;
  }
  export class AbstractFifoSamplePipe {}
  export function getWebAudioNode(...args: unknown[]): AudioNode;
}
