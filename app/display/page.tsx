"use client";

import { Suspense, useEffect, useRef, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { DriftAudioEngine } from "@/lib/audioEngine";
import { DriftVisualEngine } from "@/lib/visualEngine";
import { DriftEventListener, type NoteEvent } from "@/lib/eventListener";
import { getPublicClient, DRIFT_ABI, CONTRACT_ADDRESS } from "@/lib/contract";

type RecapState = "idle" | "loading" | "playing" | "empty";

function DisplayPage() {
  const searchParams = useSearchParams();
  const sessionId = searchParams.get("session");

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

      for (const t of recapTimersRef.current) clearTimeout(t);
      recapTimersRef.current = [];

      const BLOCK_GAP_MS = 200;
      const INTRA_BLOCK_GAP_MS = 80;

      const baseBlock = events[0].blockNum;
      let totalDuration = 0;

      const timings: number[] = [];
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const blockOffset = ev.blockNum - baseBlock;
        let intraIndex = 0;
        for (let j = i - 1; j >= 0; j--) {
          if (events[j].blockNum === ev.blockNum) intraIndex++;
          else break;
        }
        const ms = blockOffset * BLOCK_GAP_MS + intraIndex * INTRA_BLOCK_GAP_MS;
        timings.push(ms);
        if (ms > totalDuration) totalDuration = ms;
      }

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

  const startLiveListening = useCallback((sid: number) => {
    const listener = listenerRef.current;
    if (!listener) return;
    listener.startListening(sid, (note: NoteEvent) => {
      audioRef.current?.playNote(note);
      visualRef.current?.createRipple(note);
      setStats((prev) => ({
        notes: note.totalNotes,
        players: prev.players,
        block: note.blockNum,
      }));
    });
  }, []);

  const handleRecap = useCallback(async () => {
    if (!sessionId) return;
    const sid = Number(sessionId);

    if (recapState === "playing") {
      stopRecap();
      startLiveListening(sid);
      return;
    }

    setRecapState("loading");
    listenerRef.current?.stopListening();

    try {
      const listener = listenerRef.current ?? new DriftEventListener();
      const events = await listener.fetchAllEvents(sid);

      if (events.length === 0) {
        console.log("[Recap] No events found for session", sid);
        setRecapState("empty");
        setTimeout(() => {
          setRecapState("idle");
          startLiveListening(sid);
        }, 3000);
        return;
      }

      recapLoopRef.current = true;
      setRecapState("playing");
      setRecapProgress({ current: 0, total: events.length });
      scheduleRecapLoop(events);
    } catch (err) {
      console.error("Recap failed:", err);
      setRecapState("idle");
      startLiveListening(sid);
    }
  }, [recapState, sessionId, stopRecap, scheduleRecapLoop, startLiveListening]);

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

    setStarted(true);

    return () => {
      clearInterval(sessionPoll);
    };
  }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecap();
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
