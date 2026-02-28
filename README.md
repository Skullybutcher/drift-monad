# DRIFT — Real-Time On-Chain Music

> Every transaction has a sound. Every block is a beat. The blockchain is the orchestra.

DRIFT is a decentralized, real-time collaborative music instrument where every participant's touch on their phone screen becomes a Monad transaction that generates a musical note. The collective output — music and visuals — emerges from on-chain data.

## How It Works

1. **Users** open the app on their phone and touch anywhere on the screen
2. Each touch sends a transaction to the `DriftComposer` smart contract on Monad testnet
3. The contract emits a `NoteCreated` event with X/Y coordinates
4. The **display page** listens for events and maps them to music (Tone.js) + 3D ocean visualization (Three.js)
5. The result: a live collaborative composition that no one person wrote

## Tech Stack

- **Smart Contract**: Solidity 0.8.24 (Hardhat)
- **Blockchain**: Monad Testnet (Chain ID: 10143, ~1s blocks)
- **Frontend**: Next.js 14 (App Router)
- **Wallet**: Privy embedded wallets (invisible, frictionless)
- **Audio**: Tone.js (5 synths, effects chain, C minor pentatonic scale)
- **Visuals**: Three.js + custom GLSL shaders (3D ocean with ripples)
- **PWA**: Serwist (installable, offline-capable)

## Quick Start

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Privy App ID and deployer key

# Compile smart contract
npx hardhat compile

# Deploy to Monad testnet
npx hardhat run scripts/deploy.ts --network monadTestnet

# Run dev server
npm run dev
```

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Landing page with QR code + session status |
| `/play` | Mobile touch interface (what users open on their phones) |
| `/display` | Big-screen visualization (projected at venue) |

## Environment Variables

```
NEXT_PUBLIC_PRIVY_APP_ID=         # From privy.io
NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS=  # After deployment
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
DEPLOYER_PRIVATE_KEY=             # For contract deployment
```

## Musical Mapping

- **X axis** -> Pitch (C minor pentatonic, 4 octaves, 20 notes)
- **Y axis** -> Instrument (PAD / PLUCK / PIANO / BELL / BASS)
- **Notes per block** -> Volume/intensity
- **X position** -> Stereo pan

## Architecture

```
Phone (touch) --> Privy Wallet (sign tx) --> Monad (1s block) --> NoteCreated event
                                                                      |
                                                                      v
                                                    Display Page: Audio Engine + Visual Engine
```

## Why Monad?

This only works because Monad has ~1 second blocks and high TPS. On a slower L1, you'd hear one note every 10-12 seconds -- that's morse code, not music.

---

Built for [Monad Blitz Hyderabad](https://luma.com/blitz-hyderabad-feb-2026) hackathon.
