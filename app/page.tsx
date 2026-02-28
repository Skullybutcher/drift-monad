"use client";

import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getPublicClient, DRIFT_ABI, CONTRACT_ADDRESS } from "@/lib/contract";
import Link from "next/link";

export default function LandingPage() {
  const [origin, setOrigin] = useState("");
  const [sessionInfo, setSessionInfo] = useState<{
    active: boolean;
    totalNotes: number;
    uniquePlayers: number;
  } | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Poll session info
  useEffect(() => {
    const poll = async () => {
      try {
        const client = getPublicClient();
        const session = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: DRIFT_ABI,
          functionName: "getCurrentSession",
        });
        if (session) {
          const s = session as unknown as {
            active: boolean;
            totalNotes: bigint;
            uniquePlayers: bigint;
          };
          setSessionInfo({
            active: s.active,
            totalNotes: Number(s.totalNotes),
            uniquePlayers: Number(s.uniquePlayers),
          });
        }
      } catch {
        // Contract may not be deployed yet
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  const playUrl = `${origin}/play`;

  return (
    <div className="min-h-screen bg-[#050510] flex flex-col items-center justify-center px-4">
      {/* Title */}
      <h1 className="text-white/90 text-6xl md:text-8xl font-extralight tracking-[0.5em] mb-2">
        DRIFT
      </h1>
      <p className="text-white/30 text-sm md:text-base font-light tracking-[0.3em] mb-12">
        REAL-TIME ON-CHAIN MUSIC
      </p>

      {/* QR Code */}
      <div className="bg-white p-4 rounded-2xl mb-8">
        <QRCodeSVG
          value={playUrl || "https://drift.app/play"}
          size={200}
          level="M"
        />
      </div>
      <p className="text-white/40 text-sm font-light tracking-wider mb-8">
        Scan to play on your phone
      </p>

      {/* Session Status */}
      {sessionInfo && (
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div
              className={`w-2 h-2 rounded-full ${
                sessionInfo.active
                  ? "bg-emerald-400 animate-pulse"
                  : "bg-red-400"
              }`}
            />
            <span className="text-white/40 font-mono text-sm">
              {sessionInfo.active ? "Session Live" : "Session Ended"}
            </span>
          </div>
          <p className="text-white/25 font-mono text-xs">
            {sessionInfo.totalNotes} notes &middot; {sessionInfo.uniquePlayers}{" "}
            players
          </p>
        </div>
      )}

      {/* Navigation */}
      <div className="flex gap-4">
        <Link
          href="/play"
          className="px-6 py-3 bg-white/10 text-white/60 rounded-lg text-sm font-light tracking-wider hover:bg-white/20 transition"
        >
          Open Player
        </Link>
        <Link
          href="/display"
          className="px-6 py-3 bg-white/10 text-white/60 rounded-lg text-sm font-light tracking-wider hover:bg-white/20 transition"
        >
          Open Display
        </Link>
      </div>

      {/* Footer */}
      <p className="absolute bottom-6 text-white/15 text-xs font-mono tracking-wider">
        Powered by Monad &middot; 1s blocks &middot; Every touch is a transaction
      </p>
    </div>
  );
}
