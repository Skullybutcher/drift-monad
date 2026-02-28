# DRIFT — Real-Time On-Chain Music

> Every transaction has a sound. Every block is a beat. The blockchain is the orchestra.

DRIFT is a decentralized, real-time collaborative music instrument built on Monad. Users touch their phone screens, each touch becomes a transaction, and the collective output — music and 3D visuals — emerges live from on-chain data.

## How It Works

1. A **host** creates a session from the lobby — this deploys a new music room on-chain
2. Players scan the QR code or open the session link on their phones
3. Each touch sends a `touch(sessionId, x, y)` transaction to Monad (~1s finality)
4. The **display page** listens for `NoteCreated` events and maps them to music + 3D ocean visuals
5. When the session ends, participants can **mint an NFT** with on-chain SVG art of their session

## Tech Stack

- **Smart Contracts**: Solidity 0.8.24 (Hardhat) — `DriftComposer` + `DriftSessionNFT`
- **Blockchain**: Monad Testnet (Chain ID: 10143, ~1s blocks)
- **Frontend**: Next.js 14 (App Router)
- **Wallet**: Privy (embedded wallets for frictionless onboarding)
- **Audio**: Tone.js (5 synths: PAD, PLUCK, PIANO, BELL, BASS — C minor pentatonic)
- **Visuals**: Three.js + custom GLSL shaders (3D ocean with ripples)
- **NFTs**: ERC-721 with on-chain SVG art + `animation_url` for marketplace rendering
- **PWA**: Serwist (installable, offline-capable)

## Quick Start

```bash
npm install

cp .env.example .env.local
# Fill in your Privy App ID and deployer private key

# Compile contracts
npx hardhat compile

# Deploy DriftComposer
TS_NODE_PROJECT=tsconfig.hardhat.json npx hardhat run scripts/deploy.ts --network monadTestnet

# Deploy DriftSessionNFT (after setting NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS)
npx hardhat run scripts/deployNFT.cjs --network monadTestnet

npm run dev
```

## Pages

| Route | Purpose |
|-------|---------|
| `/` | Session lobby — create sessions, browse active/past, share QR codes |
| `/play?session=X` | Mobile touch interface — what players open on their phones |
| `/display?session=X` | Big-screen visualization — projected at venue, with recap + NFT minting |

## Smart Contracts

### DriftComposer
- `createSession()` — anyone can create a music room
- `touch(sessionId, x, y)` — record a note on-chain
- `endSession(sessionId)` — creator or owner ends the session
- Auto-expires after ~12 hours (43,200 blocks)

### DriftSessionNFT (ERC-721)
- `mintSession(sessionId)` — only participants of ended sessions can mint
- On-chain SVG with session stats (notes, players, role badge)
- `animation_url` points to the display page for live 3D rendering on marketplaces

## Environment Variables

```
NEXT_PUBLIC_PRIVY_APP_ID=                    # From privy.io
NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS=          # DriftComposer address
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=            # DriftSessionNFT address
NEXT_PUBLIC_MONAD_RPC_URL=https://testnet-rpc.monad.xyz
DEPLOYER_PRIVATE_KEY=                        # For contract deployment (server-side only)
```

## Musical Mapping

- **X axis** -> Pitch (C minor pentatonic scale, 4 octaves, 20 notes)
- **Y axis** -> Instrument (PAD / PLUCK / PIANO / BELL / BASS)
- **Note density** -> Volume/intensity
- **X position** -> Stereo pan

## Architecture

```
Phone (touch) --> Privy Wallet (sign tx) --> Monad (1s block) --> NoteCreated event
                                                                      |
                                                                      v
                                                    Display Page: Audio Engine + Visual Engine
                                                                      |
                                                                      v
                                                    Session ends --> Mint NFT (on-chain SVG)
```

## Why Monad?

This only works because Monad has ~1 second blocks and high TPS. On a slower L1, you'd hear one note every 10-12 seconds — that's morse code, not music.

---

Built for [Monad Blitz Hyderabad](https://luma.com/blitz-hyderabad-feb-2026) hackathon.
