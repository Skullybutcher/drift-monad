"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { DriftAudioEngine } from "@/lib/audioEngine";
import { DriftVisualEngine } from "@/lib/visualEngine";
import { DriftEventListener, type NoteEvent } from "@/lib/eventListener";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type WalletClient } from "viem";
import { monadTestnet } from "viem/chains";
import {
  getPublicClient,
  DRIFT_ABI,
  CONTRACT_ADDRESS,
  NFT_ABI,
  NFT_CONTRACT_ADDRESS,
} from "@/lib/contract";

type RecapState = "idle" | "playing" | "empty";

function DisplayPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumRef = useRef<HTMLCanvasElement>(null);
  const spectrumAnimRef = useRef<number>(0);
  const [started, setStarted] = useState(false);
  const [stats, setStats] = useState({ notes: 0, players: 0, block: 0 });
  const audioRef = useRef<DriftAudioEngine | null>(null);
  const visualRef = useRef<DriftVisualEngine | null>(null);
  const listenerRef = useRef<DriftEventListener | null>(null);
  // Collect all notes as they arrive live — used for recap
  const collectedNotesRef = useRef<NoteEvent[]>([]);

  // Wallet + NFT state
  const { authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [displayWallet, setDisplayWallet] = useState<WalletClient | null>(null);
  const [canMintNFT, setCanMintNFT] = useState(false);
  const [hasMintedNFT, setHasMintedNFT] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintTokenId, setMintTokenId] = useState<number | null>(null);

  // Setup wallet for minting
  useEffect(() => {
    async function setup() {
      if (wallets.length === 0) return;
      // Prefer embedded wallet — auto-signs without approval popups
      const wallet =
        wallets.find(
          (w) => w.walletClientType === "privy" || w.connectorType === "embedded"
        ) ?? wallets[0];
      try {
        await wallet.switchChain(10143);
        const provider = await wallet.getEthereumProvider();
        setDisplayWallet(
          createWalletClient({ chain: monadTestnet, transport: custom(provider) })
        );
      } catch {}
    }
    setup();
  }, [wallets]);

  // Check NFT eligibility
  useEffect(() => {
    async function check() {
      if (!displayWallet || !sessionId) return;
      const client = getPublicClient();
      const [addr] = await displayWallet.getAddresses();
      try {
        const can = await client.readContract({
          address: NFT_CONTRACT_ADDRESS,
          abi: NFT_ABI,
          functionName: "canMint",
          args: [BigInt(sessionId), addr],
        });
        const has = await client.readContract({
          address: NFT_CONTRACT_ADDRESS,
          abi: NFT_ABI,
          functionName: "hasMinted",
          args: [BigInt(sessionId), addr],
        });
        setCanMintNFT(can as boolean);
        setHasMintedNFT(has as boolean);
      } catch {}
    }
    check();
  }, [displayWallet, sessionId]);

  const handleMintNFT = useCallback(async () => {
    if (!displayWallet || !sessionId) return;
    setMinting(true);
    try {
      const [account] = await displayWallet.getAddresses();
      const hash = await displayWallet.writeContract({
        address: NFT_CONTRACT_ADDRESS,
        abi: NFT_ABI,
        functionName: "mintSession",
        args: [BigInt(sessionId)],
        account,
        chain: monadTestnet,
      });
      const client = getPublicClient();
      const receipt = await client.waitForTransactionReceipt({ hash });
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === NFT_CONTRACT_ADDRESS.toLowerCase() && log.topics[1]) {
          setMintTokenId(Number(BigInt(log.topics[1])));
          break;
        }
      }
      setCanMintNFT(false);
      setHasMintedNFT(true);
    } catch (err) {
      console.error("Mint failed:", err);
    } finally {
      setMinting(false);
    }
  }, [displayWallet, sessionId]);

  // Recap state — replays notes collected in memory, no chain re-fetch
  const [recapState, setRecapState] = useState<RecapState>("idle");
  const [recapProgress, setRecapProgress] = useState({ current: 0, total: 0 });
  const recapAbortRef = useRef<AbortController | null>(null);

  const stopRecap = useCallback(() => {
    recapAbortRef.current?.abort();
    recapAbortRef.current = null;
    setRecapState("idle");
    setRecapProgress({ current: 0, total: 0 });
  }, []);

  const handleRecap = useCallback(async () => {
    if (!sessionId) return;
    const sid = Number(sessionId);

    // Stop recap if already playing
    if (recapState === "playing") {
      stopRecap();
      // Resume live listening
      listenerRef.current?.startListening(sid, (note: NoteEvent) => {
        collectedNotesRef.current.push(note);
        audioRef.current?.playNote(note);
        visualRef.current?.createRipple(note);
        setStats((prev) => ({
          notes: note.totalNotes,
          players: prev.players,
          block: note.blockNum,
        }));
      });
      return;
    }

    // Get notes from memory
    const notes = [...collectedNotesRef.current];
    if (notes.length === 0) {
      setRecapState("empty");
      setTimeout(() => setRecapState("idle"), 2000);
      return;
    }

    // Stop live listening during recap
    listenerRef.current?.stopListening();

    const abort = new AbortController();
    recapAbortRef.current = abort;
    setRecapState("playing");
    setRecapProgress({ current: 0, total: notes.length });

    const NOTE_GAP_MS = 300;
    const audio = audioRef.current;
    const visual = visualRef.current;
    if (!audio || !visual) return;

    // Play notes sequentially in a loop
    while (!abort.signal.aborted) {
      for (let i = 0; i < notes.length; i++) {
        if (abort.signal.aborted) return;
        audio.playNote(notes[i]);
        visual.createRipple(notes[i]);
        setRecapProgress({ current: i + 1, total: notes.length });
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, NOTE_GAP_MS);
          abort.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
      // Pause between loops
      if (!abort.signal.aborted) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 2000);
          abort.signal.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
        });
      }
    }
  }, [recapState, sessionId, stopRecap]);

  const handleStart = useCallback(async () => {
    if (!canvasRef.current || !sessionId) return;
    const sid = Number(sessionId);

    const audio = new DriftAudioEngine();
    await audio.initialize();
    audio.startAmbientDrone();
    audioRef.current = audio;

    const visual = new DriftVisualEngine(canvasRef.current);
    visual.startRenderLoop();
    visualRef.current = visual;

    const listener = new DriftEventListener();
    listener.startListening(sid, (note: NoteEvent) => {
      collectedNotesRef.current.push(note);
      audio.playNote(note);
      visual.createRipple(note);
      setStats((prev) => ({
        notes: note.totalNotes,
        players: prev.players,
        block: note.blockNum,
      }));
    });
    listenerRef.current = listener;

    // Poll session info
    const sessionPoll = setInterval(async () => {
      try {
        const client = getPublicClient();
        const session = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: DRIFT_ABI,
          functionName: "getSession",
          args: [BigInt(sid)],
        });
        if (session) {
          const s = session as unknown as {
            totalNotes: bigint;
            uniquePlayers: bigint;
            active: boolean;
          };
          setStats((prev) => ({
            ...prev,
            notes: Number(s.totalNotes),
            players: Number(s.uniquePlayers),
          }));
        }
      } catch {}
    }, 5000);

    // Start spectrum visualizer
    const specCanvas = spectrumRef.current;
    if (specCanvas) {
      const ctx = specCanvas.getContext("2d")!;
      const resize = () => {
        specCanvas.width = window.innerWidth;
        specCanvas.height = 120;
      };
      resize();
      window.addEventListener("resize", resize);

      const drawSpectrum = () => {
        spectrumAnimRef.current = requestAnimationFrame(drawSpectrum);
        const data = audio.getFFTData();
        if (data.length === 0) return;

        const w = specCanvas.width;
        const h = specCanvas.height;
        ctx.clearRect(0, 0, w, h);

        // Use lower half of FFT bins (more musical range)
        const binCount = Math.floor(data.length / 2);
        const barWidth = w / binCount;

        for (let i = 0; i < binCount; i++) {
          // dB range: -100 (silent) to 0 (max) → normalize to 0-1
          const db = data[i];
          const norm = Math.max(0, (db + 100) / 100);
          const barH = norm * h;

          // Color gradient: purple at low freq → cyan at high freq
          const hue = 260 + (i / binCount) * 60; // 260 (purple) to 320 (pink)
          const alpha = 0.3 + norm * 0.5;
          ctx.fillStyle = `hsla(${hue}, 70%, 60%, ${alpha})`;
          ctx.fillRect(i * barWidth, h - barH, barWidth - 1, barH);
        }
      };
      drawSpectrum();
    }

    setStarted(true);

    return () => {
      clearInterval(sessionPoll);
    };
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecap();
      cancelAnimationFrame(spectrumAnimRef.current);
      listenerRef.current?.stopListening();
      visualRef.current?.dispose();
      audioRef.current?.dispose();
    };
  }, [stopRecap]);

  // No session selected
  if (!sessionId) {
    return (
      <div className="fixed inset-0 bg-black flex flex-col items-center justify-center gap-5">
        <h1 className="text-white/60 text-2xl font-extralight tracking-[0.3em]">
          DRIFT
        </h1>
        <p className="text-white/30 text-sm font-light">No session selected</p>
        <Link
          href="/"
          className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white/60 rounded-lg text-sm font-light tracking-wider transition-all border border-white/10"
        >
          Go to lobby
        </Link>
      </div>
    );
  }

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* Three.js canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ width: "100vw", height: "100vh" }}
      />

      {/* Spectrum analyser — bottom of screen */}
      {started && (
        <canvas
          ref={spectrumRef}
          className="absolute bottom-0 left-0 w-full pointer-events-none z-[5]"
          style={{ height: "120px" }}
        />
      )}

      {/* HUD — bottom left */}
      {started && (
        <div className="absolute bottom-6 left-6 text-white/40 font-mono text-sm z-10">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full animate-pulse ${
                recapState === "playing" ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            <span>
              DRIFT — Session #{sessionId} —{" "}
              {recapState === "playing" ? "Recap" : "Live"}
            </span>
          </div>
          <div className="mt-1 text-white/25">
            {recapState === "playing"
              ? `${recapProgress.current} / ${recapProgress.total} notes (looping)`
              : `${stats.notes} notes \u00B7 ${stats.players} players \u00B7 Monad`}
          </div>
        </div>
      )}

      {/* Bottom-right buttons: Mint + Recap */}
      {started && (
        <div className="absolute bottom-6 right-6 z-10 flex gap-3">
          {/* Mint NFT button */}
          {authenticated && canMintNFT && !hasMintedNFT && (
            <button
              onClick={handleMintNFT}
              disabled={minting}
              className="px-5 py-2.5 rounded-lg font-mono text-sm tracking-wider transition-all border bg-purple-500/20 border-purple-500/40 text-purple-300 hover:bg-purple-500/30 disabled:opacity-50"
            >
              {minting ? "minting..." : "Mint NFT"}
            </button>
          )}
          {authenticated && hasMintedNFT && (
            <span className="px-5 py-2.5 rounded-lg font-mono text-sm tracking-wider border bg-emerald-500/10 border-emerald-500/20 text-emerald-400/60">
              {mintTokenId ? `NFT #${mintTokenId}` : "minted"}
            </span>
          )}
          {!authenticated && (
            <button
              onClick={() => login()}
              className="px-5 py-2.5 rounded-lg font-mono text-xs tracking-wider transition-all border bg-white/5 border-white/10 text-white/30 hover:text-white/50"
            >
              connect to mint
            </button>
          )}

          {/* Recap button */}
          <button
            onClick={handleRecap}
            disabled={recapState === "empty"}
            className={`px-5 py-2.5 rounded-lg font-mono text-sm tracking-wider transition-all border ${
              recapState === "playing"
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
                : recapState === "empty"
                ? "bg-red-500/10 border-red-500/30 text-red-300/60"
                : "bg-white/10 border-white/20 text-white/60 hover:bg-white/20 hover:text-white/80"
            }`}
          >
            {recapState === "playing"
              ? "stop recap"
              : recapState === "empty"
              ? "no notes yet"
              : "recap"}
          </button>
        </div>
      )}

      {/* Block number — top right */}
      {started && stats.block > 0 && recapState !== "playing" && (
        <div className="absolute top-6 right-6 text-white/20 font-mono text-xs z-10">
          Block #{stats.block}
        </div>
      )}

      {/* Click-to-start overlay */}
      {!started && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/80 cursor-pointer z-20"
          onClick={handleStart}
        >
          <div className="text-center">
            <h1 className="text-white/80 text-4xl font-light tracking-[0.4em] mb-2">
              DRIFT
            </h1>
            <p className="text-white/40 text-sm font-mono mb-6">
              Session #{sessionId}
            </p>
            <p className="text-white/30 text-lg font-light tracking-widest">
              CLICK TO BEGIN
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DisplayPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 bg-black flex items-center justify-center">
          <div className="text-white/30 text-lg font-light tracking-[0.3em] animate-pulse">
            loading...
          </div>
        </div>
      }
    >
      <DisplayPage />
    </Suspense>
  );
}
