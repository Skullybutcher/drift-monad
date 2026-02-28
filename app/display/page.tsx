"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { DriftAudioEngine } from "@/lib/audioEngine";
import { DriftVisualEngine } from "@/lib/visualEngine";
import { DriftEventListener, type NoteEvent } from "@/lib/eventListener";
import { getPublicClient, DRIFT_ABI, CONTRACT_ADDRESS } from "@/lib/contract";

export default function DisplayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [stats, setStats] = useState({ notes: 0, players: 0, block: 0 });
  const audioRef = useRef<DriftAudioEngine | null>(null);
  const visualRef = useRef<DriftVisualEngine | null>(null);
  const listenerRef = useRef<DriftEventListener | null>(null);

  const handleStart = useCallback(async () => {
    if (!canvasRef.current) return;

    // Initialize engines
    const audio = new DriftAudioEngine();
    await audio.initialize();
    audio.startAmbientDrone();
    audioRef.current = audio;

    const visual = new DriftVisualEngine(canvasRef.current);
    visual.startRenderLoop();
    visualRef.current = visual;

    // Start event listener
    const listener = new DriftEventListener();
    listener.startListening((note: NoteEvent) => {
      audio.playNote(note);
      visual.createRipple(note);
      setStats((prev) => ({
        notes: note.totalNotes,
        players: prev.players,
        block: note.blockNum,
      }));
    });
    listenerRef.current = listener;

    // Poll session info periodically
    const sessionPoll = setInterval(async () => {
      try {
        const client = getPublicClient();
        const session = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: DRIFT_ABI,
          functionName: "getCurrentSession",
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
      } catch {
        // Session read may fail before contract is deployed
      }
    }, 5000);

    setStarted(true);

    return () => {
      clearInterval(sessionPoll);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      listenerRef.current?.stopListening();
      visualRef.current?.dispose();
      audioRef.current?.dispose();
    };
  }, []);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* Three.js canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ width: "100vw", height: "100vh" }}
      />

      {/* Minimal HUD — bottom left */}
      {started && (
        <div className="absolute bottom-6 left-6 text-white/40 font-mono text-sm z-10">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>DRIFT — Session Live</span>
          </div>
          <div className="mt-1 text-white/25">
            {stats.notes} notes &middot; {stats.players} players &middot; Monad
          </div>
        </div>
      )}

      {/* Block number — top right */}
      {started && stats.block > 0 && (
        <div className="absolute top-6 right-6 text-white/20 font-mono text-xs z-10">
          Block #{stats.block}
        </div>
      )}

      {/* Click-to-start overlay (browser autoplay policy) */}
      {!started && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/80 cursor-pointer z-20"
          onClick={handleStart}
        >
          <div className="text-center">
            <h1 className="text-white/80 text-4xl font-light tracking-[0.4em] mb-4">
              DRIFT
            </h1>
            <p className="text-white/30 text-lg font-light tracking-widest">
              CLICK TO BEGIN
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
