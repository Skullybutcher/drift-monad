"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { DriftAudioEngine } from "@/lib/audioEngine";
import { DriftVisualEngine } from "@/lib/visualEngine";
import { DriftEventListener, type NoteEvent } from "@/lib/eventListener";
import { getPublicClient, DRIFT_ABI, CONTRACT_ADDRESS } from "@/lib/contract";

type RecapState = "idle" | "loading" | "playing" | "empty";

export default function DisplayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [started, setStarted] = useState(false);
  const [stats, setStats] = useState({ notes: 0, players: 0, block: 0 });
  const audioRef = useRef<DriftAudioEngine | null>(null);
  const visualRef = useRef<DriftVisualEngine | null>(null);
  const listenerRef = useRef<DriftEventListener | null>(null);

  // Recap state
  const [recapState, setRecapState] = useState<RecapState>("idle");
  const [recapProgress, setRecapProgress] = useState({ current: 0, total: 0 });
  const recapTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const recapLoopRef = useRef(true);
  const recapEventsRef = useRef<NoteEvent[]>([]);

  const stopRecap = useCallback(() => {
    recapLoopRef.current = false;
    for (const t of recapTimersRef.current) clearTimeout(t);
    recapTimersRef.current = [];
    setRecapState("idle");
    setRecapProgress({ current: 0, total: 0 });
  }, []);

  const scheduleRecapLoop = useCallback(
    (events: NoteEvent[]) => {
      const audio = audioRef.current;
      const visual = visualRef.current;
      if (!audio || !visual || events.length === 0) return;

      // Clear any existing timers
      for (const t of recapTimersRef.current) clearTimeout(t);
      recapTimersRef.current = [];

      // Calculate timing: use block numbers to derive relative timing
      // Each block is ~1s on Monad, so gap = (blockDiff) * 200ms for faster recap
      // Also use noteIndex within the same block for sub-block spacing
      const BLOCK_GAP_MS = 200; // each block gap compressed to 200ms for recap
      const INTRA_BLOCK_GAP_MS = 80; // notes within same block spaced 80ms apart

      const baseBlock = events[0].blockNum;
      let totalDuration = 0;

      const timings: number[] = [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const blockOffset = ev.blockNum - baseBlock;
        // Count how many notes before this one share the same block
        let intraIndex = 0;
        for (let j = i - 1; j >= 0; j--) {
          if (events[j].blockNum === ev.blockNum) intraIndex++;
          else break;
        }
        const ms = blockOffset * BLOCK_GAP_MS + intraIndex * INTRA_BLOCK_GAP_MS;
        timings.push(ms);
        if (ms > totalDuration) totalDuration = ms;
      }

      // Add a 2-second pause at the end before looping
      const loopDuration = totalDuration + 2000;

      const scheduleOnce = () => {
        for (let i = 0; i < events.length; i++) {
          const timer = setTimeout(() => {
            audio.playNote(events[i]);
            visual.createRipple(events[i]);
            setRecapProgress({ current: i + 1, total: events.length });
          }, timings[i]);
          recapTimersRef.current.push(timer);
        }

        // Schedule next loop
        const loopTimer = setTimeout(() => {
          if (recapLoopRef.current) {
            recapTimersRef.current = [];
            scheduleOnce();
          }
        }, loopDuration);
        recapTimersRef.current.push(loopTimer);
      };

      scheduleOnce();
    },
    []
  );

  const handleRecap = useCallback(async () => {
    if (recapState === "playing") {
      stopRecap();
      // Resume live listening
      const listener = listenerRef.current;
      if (listener && audioRef.current && visualRef.current) {
        listener.startListening((note: NoteEvent) => {
          audioRef.current?.playNote(note);
          visualRef.current?.createRipple(note);
          setStats((prev) => ({
            notes: note.totalNotes,
            players: prev.players,
            block: note.blockNum,
          }));
        });
      }
      return;
    }

    setRecapState("loading");

    // Pause live listening during recap
    listenerRef.current?.stopListening();

    try {
      const listener = listenerRef.current ?? new DriftEventListener();
      const events = await listener.fetchAllEvents();

      if (events.length === 0) {
        console.log("[Recap] No events found on-chain");
        setRecapState("empty");
        // Show "no events" briefly then go back to idle and resume live
        setTimeout(() => {
          setRecapState("idle");
          listenerRef.current?.startListening((note: NoteEvent) => {
            audioRef.current?.playNote(note);
            visualRef.current?.createRipple(note);
            setStats((prev) => ({
              notes: note.totalNotes,
              players: prev.players,
              block: note.blockNum,
            }));
          });
        }, 3000);
        return;
      }

      recapEventsRef.current = events;
      recapLoopRef.current = true;
      setRecapState("playing");
      setRecapProgress({ current: 0, total: events.length });
      scheduleRecapLoop(events);
    } catch (err) {
      console.error("Recap failed:", err);
      setRecapState("idle");
      // Resume live
      listenerRef.current?.startListening((note: NoteEvent) => {
        audioRef.current?.playNote(note);
        visualRef.current?.createRipple(note);
      });
    }
  }, [recapState, stopRecap, scheduleRecapLoop]);

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
      stopRecap();
      listenerRef.current?.stopListening();
      visualRef.current?.dispose();
      audioRef.current?.dispose();
    };
  }, [stopRecap]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-black">
      {/* Three.js canvas — pointer-events-none so HUD buttons stay clickable */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ width: "100vw", height: "100vh" }}
      />

      {/* Minimal HUD — bottom left */}
      {started && (
        <div className="absolute bottom-6 left-6 text-white/40 font-mono text-sm z-10">
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full animate-pulse ${
                recapState === "playing" ? "bg-amber-400" : "bg-emerald-400"
              }`}
            />
            <span>
              DRIFT —{" "}
              {recapState === "playing" ? "Recap Playing" : "Session Live"}
            </span>
          </div>
          <div className="mt-1 text-white/25">
            {recapState === "playing"
              ? `${recapProgress.current} / ${recapProgress.total} notes (looping)`
              : `${stats.notes} notes \u00B7 ${stats.players} players \u00B7 Monad`}
          </div>
        </div>
      )}

      {/* Recap button — bottom right */}
      {started && (
        <div className="absolute bottom-6 right-6 z-10">
          <button
            onClick={handleRecap}
            disabled={recapState === "loading" || recapState === "empty"}
            className={`px-5 py-2.5 rounded-lg font-mono text-sm tracking-wider transition-all border ${
              recapState === "playing"
                ? "bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30"
                : recapState === "loading"
                ? "bg-white/5 border-white/10 text-white/30 cursor-wait"
                : recapState === "empty"
                ? "bg-red-500/10 border-red-500/30 text-red-300/60"
                : "bg-white/10 border-white/20 text-white/60 hover:bg-white/20 hover:text-white/80"
            }`}
          >
            {recapState === "loading"
              ? "loading..."
              : recapState === "playing"
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
