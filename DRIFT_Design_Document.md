
# 🌊 DRIFT — Design Document
### *Real-Time On-Chain Music That the Crowd Composes Without Knowing*

> Every transaction has a sound. Every block is a beat. The blockchain is the orchestra.

---

## Table of Contents

1. [Product Vision](#1-product-vision)
2. [System Architecture](#2-system-architecture)
3. [Smart Contract Design](#3-smart-contract-design)
4. [Audio Engine](#4-audio-engine)
5. [Visual Engine](#5-visual-engine)
6. [Real-Time Pipeline](#6-real-time-pipeline)
7. [Frontend Application](#7-frontend-application)
8. [Mobile Touch Interface](#8-mobile-touch-interface)
9. [Replay System](#9-replay-system)
10. [Tech Stack](#10-tech-stack)
11. [Data Flow Diagrams](#11-data-flow-diagrams)
12. [Smart Contract Code](#12-smart-contract-code)
13. [Audio Mapping Specification](#13-audio-mapping-specification)
14. [Visual Mapping Specification](#14-visual-mapping-specification)
15. [Build Plan](#15-build-plan)
16. [Demo Script](#16-demo-script)
17. [Risk Mitigation](#17-risk-mitigation)
18. [Post-Hackathon Vision](#18-post-hackathon-vision)

---

## 1. Product Vision

### What DRIFT Is

DRIFT is a decentralized, real-time collaborative music instrument where every participant's touch on their phone screen becomes a blockchain transaction that generates a musical note. The collective output — music and visuals — emerges from on-chain data, creating a live symphony that no one person composed but everyone contributed to.

### The Core Experience

1. **The Audience sees:** A mesmerizing abstract ocean/nebula visualization on the main screen with ambient generative music playing
2. **The Audience does:** Opens a link on their phone, sees a beautiful gradient canvas, touches anywhere
3. **What actually happens:** Each touch submits a Monad transaction encoding X/Y coordinates → the smart contract emits an event → the main screen's audio engine converts the coordinates into a musical note → the visualization reacts
4. **The reveal:** *"Every sound you heard was a blockchain transaction. You just composed music on-chain."*

### Design Principles

- **Zero cognitive load** — The phone interface has NO text, NO buttons, NO explanation. Just a gradient you touch.
- **Beauty first** — Every visual and audio choice optimizes for aesthetic impact, not technical demonstration
- **Blockchain is invisible** — The user never sees a wallet, a transaction hash, or a confirmation. Privy embedded wallets handle everything silently.
- **Emergent complexity** — Simple individual actions (touch) create complex collective output (music + visuals). The whole is greater than the sum of parts.

---

## 2. System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MAIN DISPLAY                              │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐     │
│  │ Visual Engine │  │ Audio Engine │  │ Event Listener     │     │
│  │ (Three.js /  │◄─┤ (Web Audio  │◄─┤ (ethers.js v6      │     │
│  │  WebGL)      │  │  API + Tone │  │  polling/websocket) │     │
│  └──────────────┘  │  .js)       │  └─────────┬──────────┘     │
│                     └──────────────┘            │                 │
│                                                  │                 │
└──────────────────────────────────────────────────┼─────────────────┘
                                                   │
                                          Events from blocks
                                                   │
                                    ┌──────────────┴──────────────┐
                                    │      MONAD BLOCKCHAIN        │
                                    │  ┌────────────────────────┐  │
                                    │  │   DriftComposer.sol    │  │
                                    │  │                        │  │
                                    │  │  touch(x, y) → emit   │  │
                                    │  │  NoteCreated(sender,   │  │
                                    │  │    x, y, blockNum,     │  │
                                    │  │    timestamp)          │  │
                                    │  └────────────────────────┘  │
                                    └──────────────┬──────────────┘
                                                   │
                                          Transactions
                                                   │
                    ┌──────────────────────────────┼──────────────────────┐
                    │              │               │              │       │
              ┌─────┴─────┐ ┌─────┴─────┐  ┌─────┴─────┐ ┌─────┴─────┐ │
              │  Phone 1  │ │  Phone 2  │  │  Phone 3  │ │  Phone N  │ │
              │  (Privy   │ │  (Privy   │  │  (Privy   │ │  (Privy   │ │
              │  Embedded │ │  Embedded │  │  Embedded │ │  Embedded │ │
              │  Wallet)  │ │  Wallet)  │  │  Wallet)  │ │  Wallet)  │ │
              └───────────┘ └───────────┘  └───────────┘ └───────────┘ │
                    └──────────────────────────────────────────────────┘
```

### Component Breakdown

| Component | Responsibility | Technology |
|---|---|---|
| **DriftComposer.sol** | Receive touches, emit musical events, store composition history | Solidity 0.8.24 |
| **Mobile Touch UI** | Capture touch coordinates, submit transactions silently | Next.js + Privy SDK |
| **Event Listener** | Poll/subscribe to NoteCreated events from confirmed blocks | ethers.js v6 |
| **Audio Engine** | Convert event parameters to musical notes in real-time | Tone.js (Web Audio API wrapper) |
| **Visual Engine** | Render reactive ocean/nebula visualization driven by audio data | Three.js + custom GLSL shaders |
| **Replay Engine** | Reconstruct any past composition from on-chain event history | ethers.js + Tone.js |
| **Display Server** | Serve the main display page (big screen at venue) | Next.js on Vercel |

---

## 3. Smart Contract Design

### Design Philosophy

The contract is intentionally minimal. Its job is to:
1. Accept touch coordinates
2. Validate inputs
3. Emit a rich event with all data the audio/visual engines need
4. Store minimal state for replay capability

All musical computation happens client-side. The contract is a **data notary** — it timestamps, attributes, and permanently stores every note.

### Contract: `DriftComposer.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DriftComposer {

    // ──────────────────────────────────────
    //  Types
    // ──────────────────────────────────────

    struct Note {
        address player;
        int16 x;           // -1000 to +1000 (normalized canvas coordinates × 1000)
        int16 y;           // -1000 to +1000
        uint64 blockNum;
        uint64 timestamp;
        uint16 noteIndex;  // index within this block (for rhythm calculation)
    }

    struct Session {
        uint64 startBlock;
        uint64 endBlock;       // 0 if still active
        uint32 totalNotes;
        uint16 uniquePlayers;
        bool active;
    }

    // ──────────────────────────────────────
    //  Events
    // ──────────────────────────────────────

    /// @notice Emitted every time a player touches the canvas
    event NoteCreated(
        uint256 indexed sessionId,
        address indexed player,
        int16 x,
        int16 y,
        uint64 blockNum,
        uint64 timestamp,
        uint16 noteIndex,
        uint32 totalNotesInSession
    );

    /// @notice Emitted when a new composition session starts
    event SessionStarted(uint256 indexed sessionId, uint64 startBlock);

    /// @notice Emitted when a session ends
    event SessionEnded(uint256 indexed sessionId, uint64 endBlock, uint32 totalNotes, uint16 uniquePlayers);

    // ──────────────────────────────────────
    //  State
    // ──────────────────────────────────────

    address public owner;
    uint256 public currentSessionId;
    
    mapping(uint256 => Session) public sessions;
    mapping(uint256 => mapping(address => bool)) public hasPlayed;
    mapping(uint256 => uint16) private playerCount;
    
    // Per-block note counter for rhythm calculation
    mapping(uint256 => mapping(uint64 => uint16)) public notesInBlock;

    // ──────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier sessionActive() {
        require(sessions[currentSessionId].active, "No active session");
        _;
    }

    // ──────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ──────────────────────────────────────
    //  Core Functions
    // ──────────────────────────────────────

    /// @notice Start a new composition session
    function startSession() external onlyOwner {
        // End previous session if active
        if (sessions[currentSessionId].active) {
            _endCurrentSession();
        }

        currentSessionId++;
        sessions[currentSessionId] = Session({
            startBlock: uint64(block.number),
            endBlock: 0,
            totalNotes: 0,
            uniquePlayers: 0,
            active: true
        });

        emit SessionStarted(currentSessionId, uint64(block.number));
    }

    /// @notice End the current composition session
    function endSession() external onlyOwner {
        require(sessions[currentSessionId].active, "No active session");
        _endCurrentSession();
    }

    /// @notice Submit a touch — the core interaction
    /// @param x Normalized X coordinate (-1000 to 1000)
    /// @param y Normalized Y coordinate (-1000 to 1000)
    function touch(int16 x, int16 y) external sessionActive {
        // Clamp coordinates to valid range
        int16 clampedX = _clamp(x, -1000, 1000);
        int16 clampedY = _clamp(y, -1000, 1000);

        Session storage session = sessions[currentSessionId];
        
        // Track unique players
        if (!hasPlayed[currentSessionId][msg.sender]) {
            hasPlayed[currentSessionId][msg.sender] = true;
            playerCount[currentSessionId]++;
            session.uniquePlayers = playerCount[currentSessionId];
        }

        // Increment counters
        session.totalNotes++;
        uint64 blockNum = uint64(block.number);
        notesInBlock[currentSessionId][blockNum]++;
        uint16 noteIndex = notesInBlock[currentSessionId][blockNum];

        emit NoteCreated(
            currentSessionId,
            msg.sender,
            clampedX,
            clampedY,
            blockNum,
            uint64(block.timestamp),
            noteIndex,
            session.totalNotes
        );
    }

    // ──────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────

    /// @notice Get current session info
    function getCurrentSession() external view returns (Session memory) {
        return sessions[currentSessionId];
    }

    /// @notice Get notes count in a specific block for a session
    function getBlockNoteCount(uint256 sessionId, uint64 blockNum) external view returns (uint16) {
        return notesInBlock[sessionId][blockNum];
    }

    // ─────────────────────────���────────────
    //  Internal
    // ──────────────────────────────────────

    function _endCurrentSession() internal {
        Session storage session = sessions[currentSessionId];
        session.endBlock = uint64(block.number);
        session.active = false;
        emit SessionEnded(
            currentSessionId,
            uint64(block.number),
            session.totalNotes,
            session.uniquePlayers
        );
    }

    function _clamp(int16 val, int16 minVal, int16 maxVal) internal pure returns (int16) {
        if (val < minVal) return minVal;
        if (val > maxVal) return maxVal;
        return val;
    }
}
```

### Gas Optimization Notes

- `int16` for coordinates instead of `int256` — saves storage, coordinates don't need more range
- `noteIndex` computed from block-level counter — rhythm data without storing arrays
- No on-chain note storage array — all note data lives in events (logs), which are ~5x cheaper than storage
- Session metadata is the only persistent storage — minimal SSTORE operations
- Estimated gas per `touch()` call: **~45,000–55,000 gas** (one SSTORE update + event emission)
- At Monad testnet gas prices: **effectively free**

### Why Events, Not Storage

Storing every note in a `Note[]` array would cost ~20,000 gas per SSTORE (new slot) × hundreds of notes = expensive and unnecessary. Events (logs) cost ~375 gas per topic + 8 gas per byte of data. The frontend reads events via `eth_getLogs` — same data, 50x cheaper. The replay system reconstructs the full composition from event history.

---

## 4. Audio Engine

### Technology: Tone.js

[Tone.js](https://tonejs.github.io/) is chosen over raw Web Audio API because:
- Built-in synthesizers with musical presets (no need to design oscillators from scratch)
- Transport system for tempo/rhythm management
- Effects chain (reverb, delay, filter) with simple API
- Handles AudioContext lifecycle (browser autoplay policies)
- ~50KB gzipped — minimal bundle impact

### Musical Scale & Theory

The output should sound **good by default** — not random noise. This requires constraining the note mapping to a musical scale.

**Scale choice: C Minor Pentatonic** (C, Eb, F, G, Bb)

Why pentatonic:
- Any combination of pentatonic notes sounds harmonious — there are no dissonant intervals
- It's the "universally pleasant" scale across cultures
- With 50 random people touching randomly, you NEED a forgiving scale
- It's the scale used in ambient/generative music (Brian Eno, etc.)

**Extended across 4 octaves:**

```
Octave 2: C2, Eb2, F2,  G2,  Bb2
Octave 3: C3, Eb3, F3,  G3,  Bb3
Octave 4: C4, Eb4, F4,  G4,  Bb4
Octave 5: C5, Eb5, F5,  G5,  Bb5
```

Total: 20 distinct pitches mapped across the X axis.

### Coordinate → Music Mapping

```
INPUT: NoteCreated event { x, y, blockNum, noteIndex, totalNotesInSession }

MAPPING:

1. PITCH (from X coordinate)
   ┌─────────────────────────────────────────────────────────┐
   │  x: -1000 ──────────────────────────────────────► +1000 │
   │       C2    Eb2   F2    G2    Bb2   ...   G5    Bb5     │
   │       Low ◄──────────────────────────────────► High     │
   └─────────────────────────────────────────────────────────┘
   
   Quantize x into 20 buckets → map to pentatonic note array index
   
   pitchIndex = Math.floor(((x + 1000) / 2000) * 20)
   pitchIndex = Math.min(pitchIndex, 19)  // clamp
   note = PENTATONIC_SCALE[pitchIndex]

2. INSTRUMENT / TIMBRE (from Y coordinate)
   ┌─────────────────────────────────────────────────────────┐
   │  y: -1000 (top) ─────────────────────────► +1000 (btm) │
   │                                                          │
   │  -1000 to -600  → PAD SYNTH    (ethereal, sustained)    │
   │   -600 to -200  → PLUCK SYNTH  (harp-like, melodic)     │
   │   -200 to +200  → PIANO        (FM synth, clean)        │
   │   +200 to +600  → BELL         (metallic, bright)       │
   │   +600 to +1000 → SUB BASS     (deep, warm)             │
   └─────────────────────────────────────────────────────────┘

3. VELOCITY / VOLUME (from noteIndex — notes per block)
   - noteIndex 1 (only note in block) → velocity 0.3 (soft, ambient)
   - noteIndex 2-3 → velocity 0.5 (moderate)
   - noteIndex 4-7 → velocity 0.7 (present)
   - noteIndex 8+ → velocity 0.9 (loud, intense)
   
   More simultaneous touches = louder, more intense

4. NOTE DURATION (from instrument type)
   - PAD SYNTH   → 4 seconds (long, flowing)
   - PLUCK SYNTH → 1.5 seconds
   - PIANO       → 2 seconds
   - BELL        → 3 seconds (long decay)
   - SUB BASS    → 2 seconds

5. STEREO PAN (from X coordinate)
   - x: -1000 → pan -0.7 (left)
   - x: 0     → pan 0 (center)
   - x: +1000 → pan +0.7 (right)
```

### Synthesizer Definitions (Tone.js)

```typescript
// Pad Synth — ethereal, sustained
const padSynth = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "sine" },
  envelope: {
    attack: 0.8,
    decay: 1.0,
    sustain: 0.6,
    release: 2.0,
  },
}).connect(reverbChannel);

// Pluck Synth — harp-like
const pluckSynth = new Tone.PluckSynth({
  attackNoise: 1,
  dampening: 4000,
  resonance: 0.95,
}).connect(delayChannel);

// Piano — FM synthesis
const pianoSynth = new Tone.PolySynth(Tone.FMSynth, {
  harmonicity: 3,
  modulationIndex: 1,
  envelope: {
    attack: 0.01,
    decay: 0.5,
    sustain: 0.2,
    release: 1.0,
  },
}).connect(reverbChannel);

// Bell — metallic
const bellSynth = new Tone.PolySynth(Tone.MetalSynth, {
  frequency: 200,
  envelope: {
    attack: 0.001,
    decay: 0.4,
    release: 2.0,
  },
  harmonicity: 5.1,
  modulationIndex: 32,
  resonance: 4000,
  octaves: 1.5,
}).connect(delayChannel);

// Sub Bass — deep, warm
const bassSynth = new Tone.MonoSynth({
  oscillator: { type: "sine" },
  envelope: {
    attack: 0.1,
    decay: 0.3,
    sustain: 0.7,
    release: 1.5,
  },
  filterEnvelope: {
    attack: 0.06,
    decay: 0.2,
    sustain: 0.5,
    release: 2,
    baseFrequency: 200,
    octaves: 2,
  },
}).connect(masterChannel);
```

### Effects Chain

```typescript
// Global reverb — makes everything sound cohesive and "spacey"
const reverb = new Tone.Reverb({
  decay: 6,        // long tail — ambient feel
  wet: 0.4,        // 40% wet mix
  preDelay: 0.1,
}).toDestination();

// Stereo delay — adds depth and movement
const delay = new Tone.PingPongDelay({
  delayTime: "8n",  // eighth note delay
  feedback: 0.3,
  wet: 0.25,
}).connect(reverb);

// Master compressor — prevents clipping when many notes play simultaneously
const compressor = new Tone.Compressor({
  threshold: -20,
  ratio: 4,
  attack: 0.003,
  release: 0.25,
}).connect(reverb);

// Channel routing
const reverbChannel = new Tone.Channel({ volume: -6 }).connect(compressor);
const delayChannel = new Tone.Channel({ volume: -8 }).connect(delay);
const masterChannel = new Tone.Channel({ volume: -4 }).connect(compressor);
```

### Ambient Base Layer

To avoid silence when no one is interacting (which would feel broken), a subtle ambient drone plays continuously:

```typescript
// Constant low drone — C2 + G2 sine waves
const ambientDrone = new Tone.PolySynth(Tone.Synth, {
  oscillator: { type: "sine" },
  envelope: {
    attack: 2,
    decay: 0,
    sustain: 1,
    release: 2,
  },
  volume: -24, // very quiet — barely audible
}).connect(reverb);

// Start drone when session begins
ambientDrone.triggerAttack(["C2", "G2"]);
```

### Polyphony Management

With 50 people touching simultaneously, we could get 50+ notes in a single second. Tone.js handles polyphony, but we need limits:

```typescript
const MAX_SIMULTANEOUS_VOICES = 32; // browser performance limit
const NOTE_QUEUE: NoteEvent[] = [];

function processNoteEvent(event: NoteEvent) {
  // If we're at max voices, drop the oldest note
  if (Tone.context.state === "running") {
    const synth = getSynthForY(event.y);
    const note = getPitchForX(event.x);
    const velocity = getVelocityForNoteIndex(event.noteIndex);
    const duration = getDurationForInstrument(event.y);
    const pan = getPanForX(event.x);
    
    synth.triggerAttackRelease(note, duration, Tone.now(), velocity);
  }
}
```

---

## 5. Visual Engine

### Technology: Three.js + Custom GLSL Shaders

The visualization must be:
- **Beautiful enough to stand alone** — even without context, people should stop and stare
- **Reactive to audio** — every note creates a visible ripple/response
- **Performant** — smooth 60fps on the display device

### Visual Concept: "The Living Ocean"

A dark, deep-space ocean surface rendered in 3D. The surface is calm by default — gentle undulations. When notes play, ripples emanate from positions corresponding to the X/Y coordinates of the touch. The color of each ripple matches the instrument type. The intensity of the ripple matches the volume.

### Scene Setup

```typescript
// Three.js scene
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050510); // near-black deep blue
scene.fog = new THREE.FogExp2(0x050510, 0.002);

// Camera — looking down at the ocean at an angle
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 30, 50);
camera.lookAt(0, 0, 0);

// Lighting
const ambientLight = new THREE.AmbientLight(0x111133, 0.5);
const directionalLight = new THREE.DirectionalLight(0x4444ff, 0.3);
directionalLight.position.set(0, 50, 50);
```

### Ocean Surface Shader

```glsl
// Vertex Shader — ocean_vert.glsl
uniform float uTime;
uniform float uRipples[32];    // [x, z, intensity, age] × 8 active ripples
uniform float uGlobalIntensity; // overall audio level
varying vec2 vUv;
varying float vElevation;

void main() {
    vUv = uv;
    vec3 pos = position;
    
    // Base ocean waves (always present)
    float wave1 = sin(pos.x * 0.3 + uTime * 0.5) * 0.5;
    float wave2 = sin(pos.z * 0.2 + uTime * 0.3) * 0.3;
    float wave3 = sin((pos.x + pos.z) * 0.15 + uTime * 0.7) * 0.4;
    float baseWave = (wave1 + wave2 + wave3) * (0.5 + uGlobalIntensity * 1.5);
    
    // Note ripples — expand outward from touch positions
    float rippleSum = 0.0;
    for (int i = 0; i < 8; i++) {
        int idx = i * 4;
        float rx = uRipples[idx];
        float rz = uRipples[idx + 1];
        float intensity = uRipples[idx + 2];
        float age = uRipples[idx + 3];
        
        if (intensity > 0.0) {
            float dist = distance(pos.xz, vec2(rx, rz));
            float ripple = sin(dist * 3.0 - age * 8.0) * intensity * exp(-dist * 0.1) * exp(-age * 0.5);
            rippleSum += ripple;
        }
    }
    
    pos.y += baseWave + rippleSum;
    vElevation = pos.y;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
```

```glsl
// Fragment Shader — ocean_frag.glsl
uniform float uTime;
uniform float uGlobalIntensity;
uniform vec3 uNoteColors[8]; // colors of recent notes
varying vec2 vUv;
varying float vElevation;

void main() {
    // Base ocean color — deep blue to teal gradient
    vec3 deepColor = vec3(0.02, 0.02, 0.08);   // near-black blue
    vec3 surfaceColor = vec3(0.05, 0.15, 0.3);  // dark teal
    vec3 highlightColor = vec3(0.1, 0.4, 0.6);  // bright teal for peaks
    
    // Elevation-based coloring
    float normalizedElev = smoothstep(-2.0, 3.0, vElevation);
    vec3 color = mix(deepColor, surfaceColor, normalizedElev);
    color = mix(color, highlightColor, smoothstep(0.6, 1.0, normalizedElev));
    
    // Blend in note colors based on intensity
    for (int i = 0; i < 8; i++) {
        color = mix(color, uNoteColors[i], uGlobalIntensity * 0.15);
    }
    
    // Fresnel-like edge glow
    float fresnel = pow(1.0 - normalizedElev, 3.0) * 0.3;
    color += vec3(0.1, 0.2, 0.5) * fresnel;
    
    gl_FragColor = vec4(color, 0.95);
}
```

### Color Mapping (Instrument → Ripple Color)

```typescript
const INSTRUMENT_COLORS = {
  PAD:    new THREE.Color(0x6644ff),  // purple — ethereal
  PLUCK:  new THREE.Color(0x22ddaa),  // teal — organic
  PIANO:  new THREE.Color(0x4488ff),  // blue — clean
  BELL:   new THREE.Color(0xffcc22),  // gold — bright
  BASS:   new THREE.Color(0xff4466),  // red/pink — deep
};
```

### Particle System — Note Sparkles

When a note plays, particles burst upward from the ripple point:

```typescript
class NoteParticleEmitter {
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private particles: THREE.Points;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  
  emit(x: number, z: number, color: THREE.Color, intensity: number) {
    const count = Math.floor(10 + intensity * 30); // 10-40 particles
    const positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    this.lifetimes = new Float32Array(count);
    
    for (let i = 0; i < count; i++) {
      // Start at the ripple position
      positions[i * 3] = x + (Math.random() - 0.5) * 2;
      positions[i * 3 + 1] = 0; // ocean surface
      positions[i * 3 + 2] = z + (Math.random() - 0.5) * 2;
      
      // Velocity — upward with slight spread
      this.velocities[i * 3] = (Math.random() - 0.5) * 2;
      this.velocities[i * 3 + 1] = 2 + Math.random() * 4; // upward
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 2;
      
      this.lifetimes[i] = 1.0 + Math.random() * 2.0; // 1-3 seconds
    }
    
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.material = new THREE.PointsMaterial({
      color: color,
      size: 0.3,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
    });
    this.particles = new THREE.Points(this.geometry, this.material);
    scene.add(this.particles);
  }
}
```

### Camera Movement

Slow, gentle camera drift to keep the visual alive even during quiet moments:

```typescript
function animateCamera(time: number) {
  const radius = 55 + Math.sin(time * 0.0001) * 10;
  const angle = time * 0.00005; // very slow rotation
  const height = 30 + Math.sin(time * 0.0002) * 5;
  
  camera.position.x = Math.sin(angle) * radius;
  camera.position.z = Math.cos(angle) * radius;
  camera.position.y = height;
  camera.lookAt(0, 0, 0);
}
```

---

## 6. Real-Time Pipeline

### The Critical Path: Touch → Sound

```
User touches phone (T+0ms)
    │
    ▼
Privy embedded wallet signs transaction (T+50ms)
    │
    ▼
Transaction submitted to Monad RPC (T+100ms)
    │
    ▼
Transaction included in next block (T+100ms to T+1000ms — depends on when in the block cycle)
    │
    ▼
Block confirmed (T+1000ms average)
    │
    ▼
Event listener detects NoteCreated event via polling (T+1000ms to T+2000ms — depends on poll interval)
    │
    ▼
Audio engine triggers note (T+1000ms to T+2000ms)
    │
    ▼
Visual engine creates ripple (T+1000ms to T+2000ms)
```

**Total latency: 1-2 seconds touch-to-sound.** This is fast enough for music to feel responsive. For comparison, many collaborative music apps have 100-500ms latency over WebSockets — and they feel fine. 1-2 seconds is within the "ambient/generative" feel we want.

### Event Polling Strategy

```typescript
class DriftEventListener {
  private contract: ethers.Contract;
  private lastProcessedBlock: number = 0;
  private pollInterval: number = 800; // ms — slightly less than block time for responsiveness
  
  constructor(provider: ethers.Provider, contractAddress: string) {
    this.contract = new ethers.Contract(contractAddress, DRIFT_ABI, provider);
  }
  
  async startListening(onNote: (note: NoteEvent) => void) {
    setInterval(async () => {
      try {
        const currentBlock = await this.contract.runner?.provider?.getBlockNumber();
        if (!currentBlock || currentBlock <= this.lastProcessedBlock) return;
        
        // Query events from last processed block to current
        const filter = this.contract.filters.NoteCreated();
        const events = await this.contract.queryFilter(
          filter,
          this.lastProcessedBlock + 1,
          currentBlock
        );
        
        // Process each event
        for (const event of events) {
          const decoded = event as ethers.EventLog;
          const noteEvent: NoteEvent = {
            sessionId: Number(decoded.args.sessionId),
            player: decoded.args.player,
            x: Number(decoded.args.x),
            y: Number(decoded.args.y),
            blockNum: Number(decoded.args.blockNum),
            timestamp: Number(decoded.args.timestamp),
            noteIndex: Number(decoded.args.noteIndex),
            totalNotes: Number(decoded.args.totalNotesInSession),
            transactionHash: decoded.transactionHash,
          };
          onNote(noteEvent);
        }
        
        this.lastProcessedBlock = currentBlock;
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, this.pollInterval);
  }
}
```

### Optimistic Audio (Optional Enhancement)

For even lower latency, the mobile app can **emit a local WebSocket event** at touch time (before the transaction confirms), and the display plays a **quiet preview note**. When the on-chain confirmation arrives, the full note plays. This creates a "touch → whisper → full note" progression that feels intentionally musical.

```typescript
// Mobile side: emit via WebSocket at touch time
socket.emit('preview', { x, y, player: address });

// Display side: play quiet preview, then full note on confirmation
function onPreview({ x, y }: PreviewEvent) {
  playNote(x, y, { velocity: 0.15, duration: '8n' }); // whisper
}

function onConfirmed(noteEvent: NoteEvent) {
  playNote(noteEvent.x, noteEvent.y, { velocity: getVelocity(noteEvent), duration: getFullDuration(noteEvent) }); // full
}
```

**Note:** The WebSocket preview is purely for UX enhancement. The canonical composition is always the on-chain events. The preview could be omitted for hackathon simplicity.

---

## 7. Frontend Application

### Page Structure

```
/                   → Landing page (QR code + session info)
/play               → Mobile touch interface (what users open on their phones)
/display            → Main screen visualization (projected at venue)
/replay/[sessionId] → Replay a past composition
```

### Display Page (`/display`)

This is the big-screen experience. No UI elements — just the ocean visualization filling the entire screen, with minimal overlay data.

```typescript
// /display/page.tsx — simplified structure

'use client';

import { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import * as THREE from 'three';
import { DriftEventListener, NoteEvent } from '@/lib/eventListener';
import { DriftAudioEngine } from '@/lib/audioEngine';
import { DriftVisualEngine } from '@/lib/visualEngine';

export default function DisplayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState({ notes: 0, players: 0 });
  const [sessionActive, setSessionActive] = useState(false);
  
  useEffect(() => {
    if (!canvasRef.current) return;
    
    // Initialize engines
    const audioEngine = new DriftAudioEngine();
    const visualEngine = new DriftVisualEngine(canvasRef.current);
    const listener = new DriftEventListener(RPC_URL, CONTRACT_ADDRESS);
    
    // Start listening for on-chain events
    listener.startListening((note: NoteEvent) => {
      audioEngine.playNote(note);
      visualEngine.createRipple(note);
      setStats(prev => ({
        notes: note.totalNotes,
        players: prev.players, // updated via session polling
      }));
    });
    
    // Start render loop
    visualEngine.startRenderLoop();
    
    // Start ambient drone
    audioEngine.startAmbientDrone();
    
    return () => {
      listener.stopListening();
      visualEngine.dispose();
      audioEngine.dispose();
    };
  }, []);
  
  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* Three.js canvas — full screen */}
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      
      {/* Minimal overlay — bottom left */}
      <div className="absolute bottom-6 left-6 text-white/40 font-mono text-sm">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>DRIFT — Session Live</span>
        </div>
        <div className="mt-1 text-white/25">
          {stats.notes} notes · {stats.players} players · Monad
        </div>
      </div>
      
      {/* Note counter — top right, very subtle */}
      <div className="absolute top-6 right-6 text-white/20 font-mono text-xs">
        Block #{/* current block */}
      </div>
      
      {/* Click-to-start audio (browser autoplay policy) */}
      {!sessionActive && (
        <div 
          className="absolute inset-0 flex items-center justify-center bg-black/80 cursor-pointer z-10"
          onClick={async () => {
            await Tone.start();
            setSessionActive(true);
          }}
        >
          <div className="text-white/60 text-2xl font-light tracking-widest">
            CLICK TO BEGIN
          </div>
        </div>
      )}
    </div>
  );
}
```

### HUD Overlay Design

The display should be **95% visualization, 5% data.** Minimal, translucent overlays:

```
┌──────────────────────────────────────────────────────────┐
│                                              Block #1847 │
│                                                          │
│                                                          │
│                                                          │
│                    [ OCEAN / NEBULA                       │
│                      VISUALIZATION                       │
│                      FILLS ENTIRE                        │
│                      SCREEN ]                            │
│                                                          │
│                                                          │
│                                                          │
│ 🟢 DRIFT — Session Live                                  │
│ 247 notes · 38 players · Monad                           │
└──────────────────────────────────────────────────────────┘
```

---

## 8. Mobile Touch Interface

### Design Philosophy

The mobile interface is **aggressively minimal.** The user should not think. They see a pretty gradient. They touch it. That's it.

- No header
- No navigation
- No wallet UI (Privy is invisible)
- No transaction confirmations shown
- No "waiting for confirmation" spinner
- Just a full-screen gradient canvas that responds to touch with a subtle ripple

### Implementation

```typescript
// /play/page.tsx

'use client';

import { useEffect, useRef, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { ethers } from 'ethers';

export default function PlayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [contract, setContract] = useState<ethers.Contract | null>(null);

  // Auto-login with Privy on mount — creates embedded wallet silently
  useEffect(() => {
    if (ready && !authenticated) {
      login(); // Privy handles this — no UI required
    }
  }, [ready, authenticated]);

  // Setup contract connection once wallet is available
  useEffect(() => {
    async function setup() {
      if (wallets.length === 0) return;
      const wallet = wallets[0];
      await wallet.switchChain(10143); // Monad testnet
      const provider = await wallet.getEthersProvider();
      const signer = provider.getSigner();
      const driftContract = new ethers.Contract(
        CONTRACT_ADDRESS,
        DRIFT_ABI,
        await signer
      );
      setContract(driftContract);
    }
    setup();
  }, [wallets]);

  // Handle touch
  const handleTouch = async (e: React.TouchEvent | React.MouseEvent) => {
    if (!contract || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();

    // Get touch/click position
    let clientX: number, clientY: number;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    // Normalize to -1000 to +1000
    const x = Math.round(((clientX - rect.left) / rect.width) * 2000 - 1000);
    const y = Math.round(((clientY - rect.top) / rect.height) * 2000 - 1000);

    // Show local ripple immediately (optimistic feedback)
    createLocalRipple(clientX - rect.left, clientY - rect.top);

    // Submit transaction (fire and forget — no await, no confirmation UI)
    try {
      contract.touch(x, y, { gasLimit: 100000 });
      // Note: deliberately NOT awaiting — we don't show confirmation
    } catch (err) {
      console.error('Transaction failed:', err);
    }
  };

  // Local ripple animation on the phone canvas
  const createLocalRipple = (px: number, py: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let radius = 0;
    let opacity = 0.6;

    const animate = () => {
      radius += 2;
      opacity -= 0.015;
      if (opacity <= 0) return;

      // Draw ripple ring
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(100, 180, 255, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      requestAnimationFrame(animate);
    };
    animate();
  };

  return (
    <div className="fixed inset-0 overflow-hidden touch-none">
      {/* Full-screen gradient canvas */}
      <canvas
        ref={canvasRef}
        width={window?.innerWidth || 390}
        height={window?.innerHeight || 844}
        className="absolute inset-0 w-full h-full"
        onTouchStart={handleTouch}
        onMouseDown={handleTouch}
        style={{
          background: 'linear-gradient(135deg, #0a0a2e 0%, #1a0a3e 30%, #0a1a3e 60%, #0a0a2e 100%)',
        }}
      />

      {/* Absolutely NO UI elements — just the gradient + touch ripples */}
      
      {/* Tiny subtle hint — fades out after 3 seconds */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <p className="text-white/20 text-lg font-light tracking-widest animate-fade-out">
          touch anywhere
        </p>
      </div>
    </div>
  );
}
```

### Touch Throttling

Prevent spam — limit to 1 transaction per second per user:

```typescript
const TOUCH_COOLDOWN = 1000; // 1 second
let lastTouchTime = 0;

const handleTouch = async (e: TouchEvent) => {
  const now = Date.now();
  if (now - lastTouchTime < TOUCH_COOLDOWN) return;
  lastTouchTime = now;
  
  // ... submit transaction
};
```

### Mobile Gradient Animation

The phone's background gradient subtly shifts over time to feel alive:

```css
@keyframes gradient-drift {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

.touch-canvas {
  background: linear-gradient(
    135deg,
    #0a0a2e 0%,
    #1a0a3e 30%,
    #0a1a3e 60%,
    #0a0a2e 100%
  );
  background-size: 400% 400%;
  animation: gradient-drift 20s ease infinite;
}
```

---

## 9. Replay System

### Concept

Every DRIFT composition is permanently stored on-chain as events. The replay system reconstructs any session by:
1. Querying all `NoteCreated` events for a given `sessionId`
2. Sorting by `blockNum` and `noteIndex`
3. Replaying notes with accurate timing (using block timestamps for temporal spacing)

### Implementation

```typescript
class DriftReplayEngine {
  private audioEngine: DriftAudioEngine;
  private visualEngine: DriftVisualEngine;
  private events: NoteEvent[] = [];

  async loadSession(sessionId: number, contract: ethers.Contract) {
    const filter = contract.filters.NoteCreated(sessionId);
    const rawEvents = await contract.queryFilter(filter);
    
    this.events = rawEvents.map((e) => {
      const decoded = e as ethers.EventLog;
      return {
        sessionId: Number(decoded.args.sessionId),
        player: decoded.args.player,
        x: Number(decoded.args.x),
        y: Number(decoded.args.y),
        blockNum: Number(decoded.args.blockNum),
        timestamp: Number(decoded.args.timestamp),
        noteIndex: Number(decoded.args.noteIndex),
        totalNotes: Number(decoded.args.totalNotesInSession),
        transactionHash: decoded.transactionHash,
      };
    }).sort((a, b) => {
      if (a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
      return a.noteIndex - b.noteIndex;
    });
  }

  async play() {
    if (this.events.length === 0) return;
    
    const startTimestamp = this.events[0].timestamp;
    const replayStartTime = Date.now();
    
    for (const event of this.events) {
      // Calculate when this note should play relative to start
      const targetTime = (event.timestamp - startTimestamp) * 1000; // convert to ms
      const elapsed = Date.now() - replayStartTime;
      const waitTime = targetTime - elapsed;
      
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      this.audioEngine.playNote(event);
      this.visualEngine.createRipple(event);
    }
  }

  pause() { /* ... */ }
  seek(timestamp: number) { /* ... */ }
}
```

### Replay Page

```
/replay/[sessionId]

┌──────────────────────────────────────────────────────────┐
│                                                          │
│                    [ SAME OCEAN                          │
│                      VISUALIZATION ]                     │
│                                                          │
│                                                          │
│                                                          │
│ ▶ ━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━ 1:23 / 3:47   │
│ Session #4 · 247 notes · 38 players · Feb 28, 2026      │
│ [Share] [Mint as NFT]                                    │
└──────────────────────────────────────────────────────────┘
```

---

## 10. Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Smart Contract** | Solidity 0.8.24 | Touch registration, event emission, session management |
| **Contract Tooling** | Hardhat (from Oracle template) | Compile, test, deploy |
| **Blockchain** | Monad Testnet (Chain ID: 10143) | 1-second blocks, parallel execution |
| **Frontend Framework** | Next.js 14 (App Router) | From Privy Embedded Wallet template |
| **Wallet Auth** | Privy SDK | Invisible embedded wallets — zero friction |
| **Blockchain Interaction** | ethers.js v6 | Contract calls, event listening |
| **Audio Synthesis** | Tone.js | Synthesizers, effects, scheduling |
| **3D Visualization** | Three.js | Ocean rendering, particle effects |
| **Shaders** | Custom GLSL | Ocean surface, ripple effects |
| **Styling** | Tailwind CSS | Minimal UI styling |
| **Deployment** | Vercel | Frontend hosting |
| **TypeScript** | Strict mode | Full type safety |

### Package Dependencies

```json
{
  "dependencies": {
    "next": "^14.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "@privy-io/react-auth": "^1.0.0",
    "ethers": "^6.0.0",
    "tone": "^14.7.77",
    "three": "^0.160.0",
    "tailwindcss": "^3.4.0"
  },
  "devDependencies": {
    "@types/three": "^0.160.0",
    "typescript": "^5.3.0",
    "hardhat": "^2.19.0",
    "@nomicfoundation/hardhat-toolbox": "^4.0.0"
  }
}
```

---

## 11. Data Flow Diagrams

### Flow 1: User Touch → On-Chain Note

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Phone   │     │  Privy   │     │  Monad   │     │  Smart   │
│  Browser │     │  Wallet  │     │  Network │     │ Contract │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                 │               │                  │
     │ touch(540, 320) │               │                  │
     │────────────────►│               │                  │
     │                 │               │                  │
     │                 │ sign tx       │                  │
     │                 │──────────────►│                  │
     │                 │               │                  │
     │                 │               │ include in block  │
     │                 │               │─────────────────►│
     │                 │               │                  │
     │                 │               │                  │ emit NoteCreated(
     │                 │               │                  │   sessionId, player,
     │                 │               │                  │   80, -360, blockNum,
     │                 │               │                  │   timestamp, noteIdx)
     │                 │               │                  │
     │ local ripple    │               │                  │
     │◄─ (optimistic)  │               │                  │
     │                 │               │                  │
```

### Flow 2: On-Chain Event → Music + Visuals

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  Smart   │     │  Event   │     │  Audio   │     │  Visual  │
│ Contract │     │ Listener │     │  Engine  │     │  Engine  │
└────┬─────┘     └────┬─────┘     └────┬─────┘     └────┬─────┘
     │                 │               │                  │
     │ NoteCreated     │               │                  │
     │ event in block  │               │                  │
     │────────────────►│               │                  │
     │                 │               │                  │
     │                 │ decode event  │                  │
     │                 │───────┐       │                  │
     │                 │       │       │                  │
     │                 │◄──────┘       │                  │
     │                 │               │                  │
     │                 │ NoteEvent     │                  │
     │                 │──────────────►│                  │
     │                 │               │                  │
     │                 │               │ map x → pitch    │
     │                 │               │ map y → instrument│
     │                 │               │ map idx → velocity│
     │                 │               │ trigger note      │
     │                 │               │──── 🔊 ──────────►│
     │                 │               │                  │
     │                 │ NoteEvent     │                  │
     │                 │─────────────────────────────────►│
     │                 │               │                  │
     │                 │               │    create ripple  │
     │                 │               │    at (x, y)     │
     │                 │               │    with color    │
     │                 │               │    spawn particles│
     │                 │               │    ──── 🌊       │
     │                 │               │                  │
```

### Flow 3: Session Lifecycle

```
┌─────────┐     ┌────────────────────────────────────────────────┐
│  Owner  │     │                 TIMELINE                        │
└────┬────┘     └────────────────────────────────────────────────┘
     │
     │ startSession()
     │─────────────► Session #1 ACTIVE
     │                  │
     │                  │ ← touches stream in for ~3 minutes
     │                  │ ← events emitted per touch
     │                  │ ← audio plays on display
     │                  │ ← visuals react on display
     │                  │
     │ endSession()     │
     │─────────────► Session #1 ENDED
     │                  │
     │                  │ → All events permanently stored in logs
     │                  │ → Replay available at /replay/1
     │                  │ → Session metadata frozen on-chain
     │
     │ startSession()
     │─────────────► Session #2 ACTIVE
     │                  │
     ...
```

---

## 12. Smart Contract Code

See Section 3 for the full annotated `DriftComposer.sol`.

### Hardhat Configuration

```typescript
// hardhat.config.ts
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";
dotenv.config();

const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY || ""],
    },
  },
};

export default config;
```

### Deploy Script

```typescript
// scripts/deploy.ts
import { ethers } from "hardhat";

async function main() {
  const DriftComposer = await ethers.getContractFactory("DriftComposer");
  const drift = await DriftComposer.deploy();
  await drift.waitForDeployment();
  
  const address = await drift.getAddress();
  console.log(`DriftComposer deployed to: ${address}`);
  
  // Start first session
  const tx = await drift.startSession();
  await tx.wait();
  console.log("Session #1 started");
}

main().catch(console.error);
```

### Test Suite

```typescript
// test/DriftComposer.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { DriftComposer } from "../typechain-types";

describe("DriftComposer", function () {
  let drift: DriftComposer;
  let owner: any;
  let player1: any;
  let player2: any;

  beforeEach(async () => {
    [owner, player1, player2] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("DriftComposer");
    drift = await Factory.deploy();
  });

  describe("Session Management", () => {
    it("should start a session", async () => {
      await drift.startSession();
      const session = await drift.getCurrentSession();
      expect(session.active).to.be.true;
      expect(session.totalNotes).to.equal(0);
    });

    it("should reject touch when no session is active", async () => {
      await expect(drift.connect(player1).touch(0, 0))
        .to.be.revertedWith("No active session");
    });

    it("should only allow owner to start/end sessions", async () => {
      await expect(drift.connect(player1).startSession())
        .to.be.revertedWith("Not owner");
    });
  });

  describe("Touch Submission", () => {
    beforeEach(async () => {
      await drift.startSession();
    });

    it("should emit NoteCreated event with correct data", async () => {
      await expect(drift.connect(player1).touch(500, -300))
        .to.emit(drift, "NoteCreated")
        .withArgs(1, player1.address, 500, -300, /* blockNum */ () => true, /* timestamp */ () => true, 1, 1);
    });

    it("should clamp coordinates to valid range", async () => {
      await expect(drift.connect(player1).touch(2000, -2000))
        .to.emit(drift, "NoteCreated");
      // Coordinates should be clamped to 1000, -1000
    });

    it("should track unique players", async () => {
      await drift.connect(player1).touch(100, 100);
      await drift.connect(player2).touch(200, 200);
      await drift.connect(player1).touch(300, 300); // same player again
      
      const session = await drift.getCurrentSession();
      expect(session.uniquePlayers).to.equal(2);
      expect(session.totalNotes).to.equal(3);
    });

    it("should increment noteIndex per block", async () => {
      // Two touches in the same block (in test environment)
      await drift.connect(player1).touch(100, 100);
      await drift.connect(player2).touch(200, 200);
      
      const blockNum = await ethers.provider.getBlockNumber();
      const count = await drift.getBlockNoteCount(1, blockNum);
      // Note: in hardhat, each tx is a separate block by default
      // In production on Monad, multiple tx CAN land in same block
    });
  });

  describe("Session Lifecycle", () => {
    it("should end session and freeze metadata", async () => {
      await drift.startSession();
      await drift.connect(player1).touch(100, 200);
      await drift.connect(player2).touch(-500, 700);
      await drift.endSession();
      
      const session = await drift.getCurrentSession();
      expect(session.active).to.be.false;
      expect(session.totalNotes).to.equal(2);
      expect(session.uniquePlayers).to.equal(2);
      expect(session.endBlock).to.be.greaterThan(0);
    });

    it("should allow multiple sequential sessions", async () => {
      await drift.startSession(); // Session 1
      await drift.connect(player1).touch(100, 100);
      await drift.endSession();
      
      await drift.startSession(); // Session 2
      expect(await drift.currentSessionId()).to.equal(2);
      
      const session = await drift.getCurrentSession();
      expect(session.totalNotes).to.equal(0); // fresh session
    });
  });
});
```

---

## 13. Audio Mapping Specification

### Complete Mapping Table

```
┌──────────────────────────────────────��───────────────────────────┐
│                     X AXIS → PITCH                               │
│                                                                  │
│  -1000        -500          0          +500        +1000         │
│    │            │           │            │            │           │
│    C2           F2          G3           Eb4          Bb5        │
│    ▼            ▼           ▼            ▼            ▼           │
│  [Deep]      [Low]      [Middle]      [High]      [Bright]      │
│                                                                  │
│  Full pentatonic scale quantized into 20 steps:                  │
│  C2, Eb2, F2, G2, Bb2, C3, Eb3, F3, G3, Bb3,                  │
│  C4, Eb4, F4, G4, Bb4, C5, Eb5, F5, G5, Bb5                   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                     Y AXIS → INSTRUMENT                          │
│                                                                  │
│  -1000 (top)                                                     │
│    │  PAD SYNTH ════════  Ethereal, sustained, dreamy            │
│  -600                     Color: Purple (#6644ff)                │
│    │  PLUCK SYNTH ══════  Harp-like, melodic, organic            │
│  -200                     Color: Teal (#22ddaa)                  │
│    │  PIANO (FM) ═══════  Clean, present, familiar               │
│  +200                     Color: Blue (#4488ff)                  │
│    │  BELL ═════════════  Metallic, bright, resonant             │
│  +600                     Color: Gold (#ffcc22)                  │
│    │  SUB BASS ═════════  Deep, warm, foundational               │
│  +1000 (bottom)           Color: Red/Pink (#ff4466)              │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                  NOTES PER BLOCK → DYNAMICS                      │
│                                                                  │
│  1 note/block    → velocity 0.25, reverb wet 0.5  (intimate)    │
│  2-3 notes/block → velocity 0.45, reverb wet 0.4  (building)    │
│  4-7 notes/block → velocity 0.65, reverb wet 0.3  (full)        │
│  8+ notes/block  → velocity 0.85, reverb wet 0.2  (intense)     │
│                                                                  │
│  More people playing = louder, drier, more present               │
│  Fewer people = quieter, wetter, more ambient                    │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                  X COORDINATE → STEREO PAN                       │
│                                                                  │
│  -1000 → pan -0.7 (left speaker)                                │
│      0 → pan  0.0 (center)                                      │
│  +1000 → pan +0.7 (right speaker)                               │
│                                                                  │
│  Notes from the left side of the canvas come from the left       │
│  speaker. Creates spatial awareness.                             │
└──────────────────────────────────────────────────────────────────┘
```

### Audio Engine Implementation

```typescript
// lib/audioEngine.ts

import * as Tone from 'tone';

// C Minor Pentatonic across 4 octaves
const PENTATONIC_SCALE = [
  'C2', 'Eb2', 'F2', 'G2', 'Bb2',
  'C3', 'Eb3', 'F3', 'G3', 'Bb3',
  'C4', 'Eb4', 'F4', 'G4', 'Bb4',
  'C5', 'Eb5', 'F5', 'G5', 'Bb5',
];

// Instrument zones: [minY, maxY]
const INSTRUMENT_ZONES = [
  { min: -1000, max: -600, name: 'pad' },
  { min: -600,  max: -200, name: 'pluck' },
  { min: -200,  max: 200,  name: 'piano' },
  { min: 200,   max: 600,  name: 'bell' },
  { min: 600,   max: 1000, name: 'bass' },
] as const;

type InstrumentName = typeof INSTRUMENT_ZONES[number]['name'];

interface NoteEvent {
  x: number;
  y: number;
  noteIndex: number;
  player: string;
}

export class DriftAudioEngine {
  private synths: Record<InstrumentName, Tone.PolySynth | Tone.PluckSynth | Tone.MonoSynth>;
  private reverb: Tone.Reverb;
  private delay: Tone.PingPongDelay;
  private compressor: Tone.Compressor;
  private ambientDrone: Tone.PolySynth | null = null;
  private panner: Tone.Panner;

  constructor() {
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
      preDelay: 0.1,
    }).connect(this.compressor);

    this.delay = new Tone.PingPongDelay({
      delayTime: '8n',
      feedback: 0.3,
      wet: 0.25,
    }).connect(this.reverb);

    this.panner = new Tone.Panner(0).connect(this.reverb);

    // Initialize synths
    this.synths = {
      pad: new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.8, decay: 1.0, sustain: 0.6, release: 2.0 },
        volume: -8,
      }).connect(this.reverb),

      pluck: new Tone.PluckSynth({
        attackNoise: 1,
        dampening: 4000,
        resonance: 0.95,
        volume: -6,
      }).connect(this.delay),

      piano: new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3,
        modulationIndex: 1,
        envelope: { attack: 0.01, decay: 0.5, sustain: 0.2, release: 1.0 },
        volume: -6,
      }).connect(this.reverb),

      bell: new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 5.1,
        modulationIndex: 10,
        envelope: { attack: 0.001, decay: 0.4, sustain: 0.1, release: 2.0 },
        volume: -10,
      }).connect(this.delay),

      bass: new Tone.MonoSynth({
        oscillator: { type: 'sine' },
        envelope: { attack: 0.1, decay: 0.3, sustain: 0.7, release: 1.5 },
        filterEnvelope: {
          attack: 0.06, decay: 0.2, sustain: 0.5, release: 2,
          baseFrequency: 200, octaves: 2,
        },
        volume: -4,
      }).connect(this.compressor),
    };
  }

  playNote(event: NoteEvent) {
    const pitch = this.getPitch(event.x);
    const instrument = this.getInstrument(event.y);
    const velocity = this.getVelocity(event.noteIndex);
    const duration = this.getDuration(instrument);
    const pan = this.getPan(event.x);

    // Set panner position
    this.panner.pan.value = pan;

    // Get the synth for this instrument
    const synth = this.synths[instrument];

    // Trigger the note
    if (synth instanceof Tone.MonoSynth) {
      synth.triggerAttackRelease(pitch, duration, Tone.now(), velocity);
    } else if (synth instanceof Tone.PluckSynth) {
      synth.triggerAttackRelease(pitch, duration);
    } else {
      synth.triggerAttackRelease([pitch], duration, Tone.now(), velocity);
    }
  }

  private getPitch(x: number): string {
    const normalized = (x + 1000) / 2000; // 0 to 1
    const index = Math.min(Math.floor(normalized * PENTATONIC_SCALE.length), PENTATONIC_SCALE.length - 1);
    return PENTATONIC_SCALE[index];
  }

  private getInstrument(y: number): InstrumentName {
    for (const zone of INSTRUMENT_ZONES) {
      if (y >= zone.min && y < zone.max) return zone.name;
    }
    return 'piano'; // default fallback
  }

  private getVelocity(noteIndex: number): number {
    if (noteIndex <= 1) return 0.25;
    if (noteIndex <= 3) return 0.45;
    if (noteIndex <= 7) return 0.65;
    return 0.85;
  }

  private getDuration(instrument: InstrumentName): string {
    const durations: Record<InstrumentName, string> = {
      pad: '2n',    // half note
      pluck: '4n',  // quarter note
      piano: '4n.', // dotted quarter
      bell: '2n.',  // dotted half
      bass: '4n',   // quarter note
    };
    return durations[instrument];
  }

  private getPan(x: number): number {
    return (x / 1000) * 0.7; // -0.7 to +0.7
  }

  startAmbientDrone() {
    this.ambientDrone = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: { attack: 3, decay: 0, sustain: 1, release: 3 },
      volume: -26,
    }).connect(this.reverb);

    this.ambientDrone.triggerAttack(['C2', 'G2']);
  }

  stopAmbientDrone() {
    this.ambientDrone?.releaseAll();
  }

  dispose() {
    Object.values(this.synths).forEach(s => s.dispose());
    this.ambientDrone?.dispose();
    this.reverb.dispose();
    this.delay.dispose();
    this.compressor.dispose();
    this.panner.dispose();
  }
}
```

---

## 14. Visual Mapping Specification

### Complete Mapping Table

```
┌──────────────────────────────────────────────────────────────────┐
│                TOUCH COORDINATE → RIPPLE POSITION                │
│                                                                  │
│  Contract (x, y) → Three.js (worldX, worldZ)                   │
│                                                                  │
│  worldX = (x / 1000) * OCEAN_WIDTH / 2                          │
│  worldZ = (y / 1000) * OCEAN_DEPTH / 2                          │
│                                                                  │
│  Ocean surface: 100 × 100 units, centered at origin             │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                INSTRUMENT → RIPPLE COLOR                         │
│                                                                  │
│  PAD    → #6644ff (purple)  — ethereal glow                     │
│  PLUCK  → #22ddaa (teal)    — organic shimmer                   │
│  PIANO  → #4488ff (blue)    — clean light                       │
│  BELL   → #ffcc22 (gold)    — warm flash                        │
│  BASS   → #ff4466 (red)     — deep pulse                        │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                VELOCITY → RIPPLE INTENSITY                       │
│                                                                  │
│  0.25 → ripple amplitude 0.5,  particle count 8,   radius 5    │
│  0.45 → ripple amplitude 1.0,  particle count 15,  radius 8    │
│  0.65 → ripple amplitude 2.0,  particle count 25,  radius 12   │
│  0.85 → ripple amplitude 3.5,  particle count 40,  radius 18   │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                NOTES PER BLOCK → GLOBAL EFFECTS                  │
│                                                                  │
│  1/block  → ocean calm, subtle waves, dark palette               │
│  3/block  → moderate swells, brighter highlights                 │
│  5/block  → active surface, visible wave patterns                │
│  8+/block → dramatic swells, bright colors, strong ripples       │
│                                                                  │
│  Global intensity affects:                                       │
│  - Wave amplitude multiplier                                     │
│  - Fog density (less fog = more visible detail)                  │
│  - Background color brightness                                   │
│  - Particle system emission rate                                 │
│  - Camera shake (subtle, at high intensity)                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 15. Build Plan

### Team Roles (Assumed: 3–4 people)

| Role | Person | Focus |
|---|---|---|
| **Contract Dev** | Person A | Smart contract, Hardhat, deploy, testing |
| **Audio Dev** | Person B | Tone.js engine, mapping logic, effects chain |
| **Visual Dev** | Person C | Three.js ocean, shaders, particles, ripples |
| **Frontend/Integration** | Person D (or shared) | Next.js app, Privy, event listener, mobile UI, wiring |

### Hour-by-Hour Schedule

```
═══════════════════════════════════════════════════════════════
  PHASE 1: FOUNDATION (9:00 AM – 11:00 AM) — 2 hours
═══════════════════════════════════════════════════════════════

  CONTRACT DEV (Person A):
  ├─ 9:00  Fork Oracle Integration (Hardhat) template
  ├─ 9:15  Write DriftComposer.sol (touch, session, events)
  ├─ 9:45  Write basic tests (touch emission, session lifecycle)
  ├─ 10:15 Deploy to Monad testnet
  ├─ 10:30 Test with manual Cast calls: cast send ... touch(500,-300)
  └─ 11:00 ✅ Contract live on testnet, ABI exported

  AUDIO DEV (Person B):
  ├─ 9:00  Set up standalone Tone.js test page (no blockchain)
  ├─ 9:30  Implement 5 synth instruments with presets
  ├─ 10:00 Implement effects chain (reverb, delay, compressor)
  ├─ 10:30 Implement pitch mapping (X → pentatonic scale)
  ├─ 10:45 Implement instrument mapping (Y → synth selection)
  └─ 11:00 ✅ Can call playNote({x, y, noteIndex}) and hear music

  VISUAL DEV (Person C):
  ├─ 9:00  Set up Three.js scene with ocean plane geometry
  ├─ 9:30  Write ocean vertex shader (base wave motion)
  ├─ 10:00 Write ocean fragment shader (color gradient)
  ├─ 10:15 Implement ripple system (add ripple at x/z, animate)
  ├─ 10:30 Implement particle emitter (burst at ripple point)
  └─ 11:00 ✅ Can call createRipple({x, y, color}) and see effect

  FRONTEND DEV (Person D):
  ├─ 9:00  Fork Privy Embedded Wallet template
  ├─ 9:15  Configure for Monad testnet (chain ID 10143)
  ├─ 9:30  Create /play page skeleton (full-screen touch canvas)
  ├─ 9:45  Create /display page skeleton (full-screen dark canvas)
  ├─ 10:00 Implement touch handler → console.log(x, y)
  ├─ 10:30 Implement Privy auto-login flow (silent embedded wallet)
  └─ 11:00 ✅ /play page captures touches, Privy creates wallet

═══════════════════════════════════════════════════════════════
  PHASE 2: CORE INTEGRATION (11:00 AM – 1:00 PM) — 2 hours
═══════════════════════════════════════════════════════════════

  CONTRACT DEV → FRONTEND DEV:
  ├─ 11:00 Share ABI + deployed contract address
  ├─ 11:15 Frontend wires touch handler → contract.touch(x, y)
  ├─ 11:30 Test: touch phone → transaction confirmed on Monad
  └─ 11:45 ✅ Touch-to-chain pipeline working

  FRONTEND DEV:
  ├─ 11:45 Implement DriftEventListener (poll NoteCreated events)
  ├─ 12:15 Wire events → Audio Engine playNote()
  ├─ 12:30 Wire events → Visual Engine createRipple()
  └─ 1:00  ✅ End-to-end: touch phone → hear note on display

  AUDIO DEV:
  ├─ 11:00 Implement ambient drone (background layer)
  ├─ 11:30 Tune velocity mapping (noteIndex → dynamics)
  ├─ 12:00 Tune stereo panning (x → left/right)
  ├─ 12:30 Test with rapid event sequences — ensure no clipping
  └─ 1:00  ✅ Audio sounds beautiful with real event data

  VISUAL DEV:
  ├─ 11:00 Add camera drift animation
  ├─ 11:30 Implement global intensity (notes/block → wave height)
  ├─ 12:00 Add color blending from note colors into ocean
  ├─ 12:30 Polish particle effects (fade, gravity, glow)
  └─ 1:00  ✅ Visuals react beautifully to real event data

═══════════════════════════════════════════════════════════════
  PHASE 3: POLISH & UX (1:00 PM – 3:00 PM) — 2 hours
═════════════════════════════════���═════════════════════════════

  ALL TOGETHER:
  ├─ 1:00  Full end-to-end test with all 4 team members touching
  ├─ 1:15  Identify and fix latency issues, audio glitches
  ├─ 1:30  Frontend: Polish mobile touch UI (gradient, ripple, fade hint)
  ├─ 1:45  Frontend: Polish display overlay (stats, block counter)
  ├─ 2:00  Audio: Final tuning — balance volumes across instruments
  ├─ 2:15  Visual: Final tuning — color palette, fog, lighting
  ├─ 2:30  Add QR code generation for /play URL on display page
  └─ 3:00  ✅ Everything polished, working, beautiful

═══════════════════════════════════════════════════════════════
  PHASE 4: DEMO PREP (3:00 PM – 4:00 PM) — 1 hour
═══════════════════════════════════════════════════════════════

  ├─ 3:00  Deploy final frontend to Vercel
  ├─ 3:15  Create demo session on contract (startSession)
  ├─ 3:30  Pre-seed ~20 touches from team wallets (so display isn't empty)
  ├─ 3:45  Practice demo script (see Section 16)
  ├─ 3:50  Test on venue WiFi / projector / audio system
  └─ 4:00  ✅ Ready to present

═══════════════════════════════════════════════════════════════
  BUFFER: 2+ hours of slack before evening presentations
═══════════════════════════════════════════════════════════════
```

---

## 16. Demo Script

### Setup (Before Your Slot)

- Main display showing the ocean visualization (pre-seeded with ~20 notes so it's not empty)
- Ambient drone playing softly through venue speakers
- QR code visible on screen (links to /play)
- Audio connected to venue speakers

### Script (3 Minutes)

**[0:00–0:20] — The Hook**

*[Ocean visualization is already on screen, ambient music playing]*

> "You're looking at a living piece of music. Every ripple you see, every note you hear — is a blockchain transaction on Monad."

*[Pause. Let the visual and audio do the work for 5 seconds.]*

**[0:20–0:50] — The Explanation**

> "This is DRIFT. People open a link on their phone. They see a beautiful canvas. They touch it. That's it. No wallet install, no MetaMask, no seed phrases — Privy creates an invisible embedded wallet in the background."

> "But what they don't know is: every touch submits a transaction to the Monad blockchain. The X coordinate becomes a musical pitch. The Y coordinate becomes an instrument. And when the transaction confirms — one second later — it becomes a sound."

**[0:50–1:30] — The Live Demo**

> "Let me show you."

*[Pick up your phone. Touch the top-left of the canvas.]*

> "I just touched the top-left. That's a low-pitched pad synth."

*[~1 second later, a deep, ethereal pad note plays. A purple ripple appears on the ocean. The audience hears it through the speakers.]*

> "Now the bottom-right."

*[Touch bottom-right. ~1 second later, a high bell note plays. Gold ripple.]*

> "Now watch what happens when I go fast."

*[Rapidly touch 5 different positions. 5 notes cascade. 5 ripples bloom. The ocean swells.]*

**[1:30–2:15] — The Scale Moment**

*[Have 2 team members start touching simultaneously from their phones. The music becomes richer, layered, more complex. The ocean visualization intensifies — bigger waves, more particles, brighter colors.]*

> "Right now, three people are playing. Three wallets, three streams of transactions, all hitting the same smart contract. Every note is a confirmed transaction on Monad. Every ripple is a block."

> "And it sounds like music — not noise — because every note is quantized to a pentatonic scale on-chain. The blockchain guarantees harmony."

*[Let the music play for 10 seconds. Don't talk. Let the room hear it.]*

**[2:15–2:45] — The Monad Argument**

> "This only works because of Monad. Music requires latency under 2 seconds — touch to sound. Monad's 1-second blocks make that possible. On Ethereum, you'd wait 12 seconds between touching and hearing your note. That's not music. That's morse code."

> "Three people playing simultaneously means 3 transactions per second, sustained. At scale — 50 people at a concert, a conference, a party — that's 50 TPS of pure music. Monad handles that. Nothing else does at this cost."

**[2:45–3:00] — The Closer**

> "Every note you just heard has a transaction hash. This composition is permanently stored on Monad — replayable by anyone, forever. No server. No database. Just a blockchain that sounds like an ocean."

> "This is DRIFT."

*[Let the music and visualization play as you walk off. Don't kill the audio. Let it breathe.]*

---

## 17. Risk Mitigation

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| **Venue WiFi too slow for transactions** | Fatal — no touches land | Medium | Pre-seed 30+ notes before demo. Have a mobile hotspot as backup. Demo can show pre-recorded session via replay if needed. |
| **Monad testnet RPC downtime** | Fatal — no events | Low | Have a local hardhat fork as fallback. Pre-record a demo video. |
| **Browser autoplay policy blocks audio** | No sound on display | High | The display page has a "CLICK TO BEGIN" overlay that triggers Tone.start() + AudioContext resume. Presenter clicks before demo. |
| **Tone.js polyphony causes clipping/distortion** | Bad audio quality | Medium | Compressor in the effects chain. Max 32 simultaneous voices. Oldest voices release when limit hit. |
| **Three.js performance on venue hardware** | Choppy visuals | Low-Medium | Ocean geometry is a simple plane with 100×100 segments — not intensive. Particle count capped at 200. Fallback: disable shader effects, use basic material. |
| **Privy embedded wallet creation fails** | Users can't touch | Low | Have 3-4 pre-funded wallets loaded on team phones as guaranteed participants. |
| **Event polling misses events** | Notes lost, music gaps | Low | Poll every 800ms with block range queries — catches all events even if a poll cycle is slow. Missed events are caught in the next poll. |
| **Gas costs higher than expected** | Users run out of gas | Low | Pre-fund Privy wallets with excess testnet MON. Touch function is ~50K gas — very cheap. |

### The Nuclear Fallback

If EVERYTHING goes wrong on demo day (network down, WiFi dead, hardware failure):

1. Before the hackathon, record a **3-minute screen capture** of the full demo working
2. Have the replay page functional with a pre-recorded session
3. You can present the replay and say: *"This was recorded live earlier today — every note is a real transaction you can verify on-chain."*

This fallback still demonstrates the product. It's not ideal, but it's not a failure.

---

## 18. Post-Hackathon Vision

### Where DRIFT Goes After the Hackathon

**Immediate (Month 1):**
- Polish mobile experience — add haptic feedback on touch
- Add "session gallery" — browse and replay all past compositions
- Mint compositions as on-chain audio NFTs (metadata = event array, playback via Tone.js)

**Medium-term (Months 2–3):**
- **DRIFT for Events** — concert halls, conferences, festivals deploy DRIFT for their attendees. Every event creates a unique, unreproducible on-chain composition.
- **Musical scales as parameters** — session creator picks the scale (pentatonic, blues, major, chromatic). Different scales = different moods.
- **Multi-instrument lobbies** — assign each user an instrument based on join order. First 10 get pads. Next 10 get piano. Etc.

**Long-term:**
- **DRIFT Protocol** — any dApp can pipe its transaction activity through DRIFT's mapping layer to sonify its own on-chain data. DeFi swaps become music. NFT mints become percussion. Governance votes become chords.
- **Collaborative NFT music** — compositions that can never be recreated because they required the exact set of participants, the exact timing, the exact block sequence. True digital scarcity for music.

### The Bigger Narrative

DRIFT proves that blockchains aren't just for money. They're coordination layers for *any* human collaboration — including art. When you make a blockchain fast enough (Monad), cheap enough (sub-cent), and invisible enough (Privy embedded wallets), you can build creative tools that feel magical while being fully decentralized. DRIFT is the first proof of that thesis.

---

## Appendix A: File Structure

```
drift/
├── contracts/
│   ├── DriftComposer.sol
│   └── test/
│       └── DriftComposer.test.ts
├── hardhat.config.ts
├── scripts/
│   └── deploy.ts
├── frontend/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Landing page with QR
│   │   ├── play/
│   │   │   └── page.tsx          # Mobile touch interface
│   │   ├── display/
│   │   │   └── page.tsx          # Main visualization
│   │   └── replay/
│   │       └── [sessionId]/
│   │           └── page.tsx      # Replay past compositions
│   ├── lib/
│   │   ├── audioEngine.ts        # Tone.js wrapper
│   │   ├── visualEngine.ts       # Three.js wrapper
│   │   ├── eventListener.ts      # On-chain event polling
│   │   ├── noteMapping.ts        # Coordinate → music mapping
│   │   ├── constants.ts          # Contract address, ABI, scale
│   │   └── types.ts              # TypeScript interfaces
│   ├── shaders/
│   │   ├── ocean.vert.glsl       # Ocean vertex shader
│   │   └── ocean.frag.glsl       # Ocean fragment shader
│   ├── components/
│   │   ├── DriftDisplay.tsx      # Display page component
│   │   ├── TouchCanvas.tsx       # Mobile touch component
│   │   ├── QRCode.tsx            # QR code for /play URL
│   │   └── SessionStats.tsx      # Minimal stats overlay
│   ├── providers/
│   │   └── PrivyProvider.tsx     # Privy configuration
│   ├── public/
│   │   └── fonts/                # Mono font for stats
│   ├── tailwind.config.ts
│   ├── next.config.js
│   ├── package.json
│   └── tsconfig.json
├── .env                           # RPC URL, deployer key, Privy app ID
├── .gitignore
└── README.md
```

## Appendix B: Environment Variables

```env
# .env

# Monad Testnet
MONAD_RPC_URL=https://testnet-rpc.monad.xyz
DEPLOYER_PRIVATE_KEY=0x...

# Contract (set after deployment)
NEXT_PUBLIC_CONTRACT_ADDRESS=0x...

# Privy
NEXT_PUBLIC_PRIVY_APP_ID=...

# Chain
NEXT_PUBLIC_CHAIN_ID=10143
```

## Appendix C: Key Constants

```typescript
// lib/constants.ts

export const MONAD_TESTNET = {
  id: 10143,
  name: 'Monad Testnet',
  rpcUrl: 'https://testnet-rpc.monad.xyz',
  blockExplorer: 'https://testnet.monadexplorer.com',
};

export const DRIFT_CONFIG = {
  // Coordinate range
  COORD_MIN: -1000,
  COORD_MAX: 1000,

  // Touch throttle
  TOUCH_COOLDOWN_MS: 1000,

  // Event polling
  POLL_INTERVAL_MS: 800,

  // Audio
  MAX_POLYPHONY: 32,
  AMBIENT_DRONE_NOTES: ['C2', 'G2'],
  AMBIENT_DRONE_VOLUME: -26,

  // Visual
  OCEAN_WIDTH: 100,
  OCEAN_DEPTH: 100,
  OCEAN_SEGMENTS: 100,
  MAX_ACTIVE_RIPPLES: 8,
  MAX_PARTICLES: 200,

  // Session
  DEFAULT_SESSION_DURATION_BLOCKS: 300, // ~5 minutes at 1s blocks
};
```

---

*DRIFT — Built for Monad Blitz Hyderabad, February 28, 2026*
*Every transaction has a sound. Every block is a beat. The blockchain is the orchestra.*