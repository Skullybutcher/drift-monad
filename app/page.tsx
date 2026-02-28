"use client";

import { useEffect, useState, useCallback } from "react";
import { QRCodeSVG } from "qrcode.react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  custom,
  type WalletClient,
} from "viem";
import { monadTestnet } from "viem/chains";
import { getPublicClient, DRIFT_ABI, CONTRACT_ADDRESS } from "@/lib/contract";
import Link from "next/link";

interface SessionInfo {
  id: number;
  creator: string;
  totalNotes: number;
  uniquePlayers: number;
  active: boolean;
  startBlock: number;
}

export default function LobbyPage() {
  const [origin, setOrigin] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [creating, setCreating] = useState(false);
  const [qrSessionId, setQrSessionId] = useState<number | null>(null);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Setup wallet
  useEffect(() => {
    async function setup() {
      if (wallets.length === 0) return;
      const wallet =
        wallets.find(
          (w) =>
            w.walletClientType !== "privy" &&
            w.connectorType !== "embedded"
        ) ?? wallets[0];
      try {
        await wallet.switchChain(10143);
        const provider = await wallet.getEthereumProvider();
        const client = createWalletClient({
          chain: monadTestnet,
          transport: custom(provider),
        });
        setWalletClient(client);
      } catch (err) {
        console.error("Wallet setup error:", err);
      }
    }
    setup();
  }, [wallets]);

  // Poll sessions
  const fetchSessions = useCallback(async () => {
    try {
      const client = getPublicClient();
      const nextId = await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: DRIFT_ABI,
        functionName: "nextSessionId",
      });
      const total = Number(nextId as bigint);
      if (total === 0) {
        setSessions([]);
        return;
      }

      const start = Math.max(1, total - 19);
      const fetched: SessionInfo[] = [];

      for (let i = total; i >= start; i--) {
        try {
          const session = await client.readContract({
            address: CONTRACT_ADDRESS,
            abi: DRIFT_ABI,
            functionName: "getSession",
            args: [BigInt(i)],
          });
          const s = session as unknown as {
            creator: string;
            startBlock: bigint;
            totalNotes: bigint;
            uniquePlayers: bigint;
            active: boolean;
          };
          fetched.push({
            id: i,
            creator: s.creator,
            totalNotes: Number(s.totalNotes),
            uniquePlayers: Number(s.uniquePlayers),
            active: s.active,
            startBlock: Number(s.startBlock),
          });
        } catch {}
      }

      setSessions(fetched);
    } catch {
      // Contract may not be deployed
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 8000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  const handleCreateSession = async () => {
    if (!walletClient) return;
    setCreating(true);
    try {
      const [account] = await walletClient.getAddresses();
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: DRIFT_ABI,
        functionName: "createSession",
        args: [],
        account,
        chain: monadTestnet,
      });

      // Wait for receipt to get the session ID
      const client = getPublicClient();
      const receipt = await client.waitForTransactionReceipt({ hash });

      // Parse SessionStarted event to get the new sessionId
      let newSessionId: number | null = null;
      for (const log of receipt.logs) {
        try {
          // SessionStarted topic0
          if (log.topics[0] && log.topics[1]) {
            // The sessionId is the first indexed param (topics[1])
            const sid = BigInt(log.topics[1]);
            newSessionId = Number(sid);
            break;
          }
        } catch {}
      }

      if (newSessionId) {
        setQrSessionId(newSessionId);
      }

      // Refresh session list
      await fetchSessions();
    } catch (err) {
      console.error("Create session failed:", err);
    } finally {
      setCreating(false);
    }
  };

  const activeSessions = sessions.filter((s) => s.active);
  const endedSessions = sessions.filter((s) => !s.active);

  return (
    <div className="min-h-screen bg-[#050510] flex flex-col items-center px-4 py-12">
      {/* Title */}
      <h1 className="text-white/90 text-5xl md:text-7xl font-extralight tracking-[0.5em] mb-2">
        DRIFT
      </h1>
      <p className="text-white/30 text-sm font-light tracking-[0.3em] mb-10">
        REAL-TIME ON-CHAIN MUSIC
      </p>

      {/* Create Session */}
      <div className="mb-10 text-center">
        {!authenticated ? (
          <button
            onClick={() => login()}
            disabled={!ready}
            className="px-8 py-4 bg-blue-600/30 hover:bg-blue-600/50 text-white/80 rounded-xl text-lg font-light tracking-wider transition-all border border-blue-500/30 disabled:opacity-50"
          >
            Connect to create a session
          </button>
        ) : (
          <button
            onClick={handleCreateSession}
            disabled={creating || !walletClient}
            className="px-8 py-4 bg-emerald-600/30 hover:bg-emerald-600/50 text-white/80 rounded-xl text-lg font-light tracking-wider transition-all border border-emerald-500/30 disabled:opacity-50"
          >
            {creating ? "creating..." : "Create New Session"}
          </button>
        )}
      </div>

      {/* QR code for newly created or selected session */}
      {qrSessionId && origin && (
        <div className="mb-10 flex flex-col items-center gap-3">
          <p className="text-white/50 text-sm font-mono">
            Session #{qrSessionId} — share this link
          </p>
          <div className="bg-white p-4 rounded-2xl">
            <QRCodeSVG
              value={`${origin}/play?session=${qrSessionId}`}
              size={180}
              level="M"
            />
          </div>
          <p className="text-white/30 text-xs font-mono break-all max-w-xs text-center">
            {origin}/play?session={qrSessionId}
          </p>
          <div className="flex gap-3 mt-1">
            <Link
              href={`/play?session=${qrSessionId}`}
              className="px-4 py-2 bg-white/10 text-white/60 rounded-lg text-sm font-light tracking-wider hover:bg-white/20 transition border border-white/10"
            >
              Play
            </Link>
            <Link
              href={`/display?session=${qrSessionId}`}
              className="px-4 py-2 bg-white/10 text-white/60 rounded-lg text-sm font-light tracking-wider hover:bg-white/20 transition border border-white/10"
            >
              Display
            </Link>
            <button
              onClick={() => setQrSessionId(null)}
              className="px-4 py-2 text-white/30 text-sm hover:text-white/50 transition"
            >
              close
            </button>
          </div>
        </div>
      )}

      {/* Active Sessions */}
      {activeSessions.length > 0 && (
        <div className="w-full max-w-lg mb-8">
          <h2 className="text-white/40 text-xs font-mono tracking-widest mb-3 uppercase">
            Active Sessions
          </h2>
          <div className="space-y-2">
            {activeSessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg px-4 py-3"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-white/60 font-mono text-sm">
                      Session #{s.id}
                    </span>
                  </div>
                  <p className="text-white/25 font-mono text-xs mt-1">
                    {s.totalNotes} notes &middot; {s.uniquePlayers} players
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setQrSessionId(s.id)}
                    className="px-3 py-1.5 text-white/40 hover:text-white/70 text-xs font-mono transition"
                  >
                    QR
                  </button>
                  <Link
                    href={`/play?session=${s.id}`}
                    className="px-3 py-1.5 bg-white/10 text-white/50 rounded text-xs font-mono hover:bg-white/20 transition"
                  >
                    Play
                  </Link>
                  <Link
                    href={`/display?session=${s.id}`}
                    className="px-3 py-1.5 bg-white/10 text-white/50 rounded text-xs font-mono hover:bg-white/20 transition"
                  >
                    Display
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ended Sessions */}
      {endedSessions.length > 0 && (
        <div className="w-full max-w-lg mb-8">
          <h2 className="text-white/25 text-xs font-mono tracking-widest mb-3 uppercase">
            Past Sessions
          </h2>
          <div className="space-y-2">
            {endedSessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between bg-white/[0.02] border border-white/5 rounded-lg px-4 py-3"
              >
                <div>
                  <span className="text-white/30 font-mono text-sm">
                    Session #{s.id}
                  </span>
                  <p className="text-white/15 font-mono text-xs mt-1">
                    {s.totalNotes} notes &middot; {s.uniquePlayers} players
                  </p>
                </div>
                <Link
                  href={`/display?session=${s.id}`}
                  className="px-3 py-1.5 bg-white/5 text-white/30 rounded text-xs font-mono hover:bg-white/10 transition"
                >
                  Recap
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sessions.length === 0 && (
        <p className="text-white/20 text-sm font-light mt-4">
          No sessions yet. Create one to get started!
        </p>
      )}

      {/* Footer */}
      <p className="mt-auto pt-8 text-white/15 text-xs font-mono tracking-wider">
        Powered by Monad &middot; 1s blocks &middot; Every touch is a
        transaction
      </p>
    </div>
  );
}
