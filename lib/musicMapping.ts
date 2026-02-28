// C Minor Pentatonic across 4 octaves — 20 notes
// Any combination sounds harmonious
export const PENTATONIC_SCALE = [
  "C2", "Eb2", "F2", "G2", "Bb2",
  "C3", "Eb3", "F3", "G3", "Bb3",
  "C4", "Eb4", "F4", "G4", "Bb4",
  "C5", "Eb5", "F5", "G5", "Bb5",
] as const;

export type Instrument = "PAD" | "PLUCK" | "PIANO" | "BELL" | "BASS";

/**
 * Map X coordinate (-1000..+1000) to a pentatonic note.
 * Left = low, right = high.
 */
export function getPitchForX(x: number): string {
  const normalized = (x + 1000) / 2000; // 0..1
  const index = Math.min(Math.floor(normalized * 20), 19);
  return PENTATONIC_SCALE[index];
}

/**
 * Map Y coordinate (-1000..+1000) to an instrument zone.
 * Top = PAD (ethereal), Bottom = BASS (deep).
 */
export function getInstrumentForY(y: number): Instrument {
  if (y < -600) return "PAD";
  if (y < -200) return "PLUCK";
  if (y < 200) return "PIANO";
  if (y < 600) return "BELL";
  return "BASS";
}

/**
 * Map noteIndex (notes-per-block counter) to velocity.
 * More simultaneous touches = louder.
 */
export function getVelocityForNoteIndex(noteIndex: number): number {
  if (noteIndex <= 1) return 0.3;
  if (noteIndex <= 3) return 0.5;
  if (noteIndex <= 7) return 0.7;
  return 0.9;
}

/**
 * Get note duration in seconds based on instrument type.
 */
export function getDurationForInstrument(instrument: Instrument): string {
  switch (instrument) {
    case "PAD": return "4";
    case "PLUCK": return "1.5";
    case "PIANO": return "2";
    case "BELL": return "3";
    case "BASS": return "2";
  }
}

/**
 * Map X coordinate to stereo pan (-0.7 to +0.7).
 */
export function getPanForX(x: number): number {
  return (x / 1000) * 0.7;
}

/**
 * Instrument → ripple color (hex).
 */
export const INSTRUMENT_COLORS: Record<Instrument, number> = {
  PAD: 0x6644ff,   // purple
  PLUCK: 0x22ddaa, // teal
  PIANO: 0x4488ff, // blue
  BELL: 0xffcc22,  // gold
  BASS: 0xff4466,  // red/pink
};
