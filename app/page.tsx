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
import {
  getPublicClient,
  DRIFT_ABI,
  CONTRACT_ADDRESS,
  NFT_ABI,
  NFT_CONTRACT_ADDRESS,
} from "@/lib/contract";
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
  const [error, setError] = useState<string | null>(null);
  const [qrSessionId, setQrSessionId] = useState<number | null>(null);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [walletAddress, setWalletAddress] = useState<`0x${string}` | null>(null);
  const [walletReady, setWalletReady] = useState(false);

  // NFT minting state
  const [mintingSessionId, setMintingSessionId] = useState<number | null>(null);
  const [mintSuccess, setMintSuccess] = useState<{ sessionId: number; tokenId: number } | null>(null);
  const [canMintMap, setCanMintMap] = useState<Record<number, boolean>>({});
  const [hasMintedMap, setHasMintedMap] = useState<Record<number, boolean>>({});

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // Setup wallet
  useEffect(() => {
    async function setup() {
      if (wallets.length === 0) return;
      console.log("Lobby wallets:", wallets.map(w => ({ type: w.walletClientType, connector: w.connectorType, addr: w.address })));
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
        setWalletReady(true);
        const [addr] = await client.getAddresses();
        setWalletAddress(addr);
      } catch (err) {
        console.error("Wallet setup error:", err);
        setError("Wallet setup failed. Try refreshing.");
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
    } catch {}
  }, []);

  useEffect(() => {
    fetchSessions();
    const interval = setInterval(fetchSessions, 8000);
    return () => clearInterval(interval);
  }, [fetchSessions]);

  // Check NFT mint eligibility for ended sessions
  useEffect(() => {
    async function checkMintStatus() {
      if (!walletAddress || sessions.length === 0) return;
      const ended = sessions.filter((s) => !s.active);
      if (ended.length === 0) return;

      const client = getPublicClient();
      const canMap: Record<number, boolean> = {};
      const hasMap: Record<number, boolean> = {};

      for (const s of ended) {
        try {
          const can = await client.readContract({
            address: NFT_CONTRACT_ADDRESS,
            abi: NFT_ABI,
            functionName: "canMint",
            args: [BigInt(s.id), walletAddress],
          });
          const has = await client.readContract({
            address: NFT_CONTRACT_ADDRESS,
            abi: NFT_ABI,
            functionName: "hasMinted",
            args: [BigInt(s.id), walletAddress],
          });
          canMap[s.id] = can as boolean;
          hasMap[s.id] = has as boolean;
        } catch {}
      }

      setCanMintMap(canMap);
      setHasMintedMap(hasMap);
    }
    checkMintStatus();
  }, [walletAddress, sessions]);

  const handleCreateSession = async () => {
    if (!walletClient) {
      setError("Wallet not ready. Please wait or refresh.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const [account] = await walletClient.getAddresses();
      console.log("Creating session with account:", account);
      const hash = await walletClient.writeContract({
        address: CONTRACT_ADDRESS,
        abi: DRIFT_ABI,
        functionName: "createSession",
        args: [],
        account,
        chain: monadTestnet,
      });
      console.log("Create session tx:", hash);

      const client = getPublicClient();
      const receipt = await client.waitForTransactionReceipt({ hash });
      console.log("Create session receipt:", receipt.status);

      let newSessionId: number | null = null;
      for (const log of receipt.logs) {
        try {
          if (log.topics[0] && log.topics[1]) {
            const sid = BigInt(log.topics[1]);
            newSessionId = Number(sid);
            break;
          }
        } catch {}
      }

      if (newSessionId) {
        setQrSessionId(newSessionId);
      }

      await fetchSessions();
    } catch (err: unknown) {
      console.error("Create session failed:", err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        setError("Transaction rejected by wallet.");
      } else if (msg.includes("insufficient")) {
        setError("Insufficient MON for gas.");
      } else {
        setError("Failed to create session. Check console.");
      }
      setTimeout(() => setError(null), 5000);
    } finally {
      setCreating(false);
    }
  };

  const handleMintNFT = async (sessionId: number) => {
    if (!walletClient) return;
    setMintingSessionId(sessionId);
    try {
      const [account] = await walletClient.getAddresses();
      const hash = await walletClient.writeContract({
        address: NFT_CONTRACT_ADDRESS,
        abi: NFT_ABI,
        functionName: "mintSession",
        args: [BigInt(sessionId)],
        account,
        chain: monadTestnet,
      });

      const client = getPublicClient();
      const receipt = await client.waitForTransactionReceipt({ hash });

      // Parse SessionNFTMinted event — tokenId is topics[1]
      let tokenId = 0;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() === NFT_CONTRACT_ADDRESS.toLowerCase() && log.topics[1]) {
          tokenId = Number(BigInt(log.topics[1]));
          break;
        }
      }

      setMintSuccess({ sessionId, tokenId });
      setCanMintMap((prev) => ({ ...prev, [sessionId]: false }));
      setHasMintedMap((prev) => ({ ...prev, [sessionId]: true }));
      setTimeout(() => setMintSuccess(null), 6000);
    } catch (err) {
      console.error("Mint failed:", err);
    } finally {
      setMintingSessionId(null);
    }
  };

  const activeSessions = sessions.filter((s) => s.active);
  const endedSessions = sessions.filter((s) => !s.active);

  return (
    <div className="min-h-screen bg-[#050510] flex flex-col items-center px-4 py-12">
      <h1 className="text-white/90 text-5xl md:text-7xl font-extralight tracking-[0.5em] mb-2">
        DRIFT
      </h1>
      <p className="text-white/30 text-sm font-light tracking-[0.3em] mb-3">
        REAL-TIME ON-CHAIN MUSIC
      </p>
      <p className="text-purple-300/30 text-xs font-mono tracking-wider mb-10">
        Play notes on-chain &middot; Mint your session as an NFT
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
        ) : !walletReady ? (
          <div className="text-white/30 text-sm font-light animate-pulse">
            setting up wallet...
          </div>
        ) : (
          <button
            onClick={handleCreateSession}
            disabled={creating}
            className="px-8 py-4 bg-emerald-600/30 hover:bg-emerald-600/50 text-white/80 rounded-xl text-lg font-light tracking-wider transition-all border border-emerald-500/30 disabled:opacity-50"
          >
            {creating ? "creating..." : "Create New Session"}
          </button>
        )}
        {error && (
          <p className="mt-3 text-red-400/70 text-xs font-mono">{error}</p>
        )}
      </div>

      {/* Mint success toast */}
      {mintSuccess && (
        <div className="w-full max-w-lg mb-4 px-4 py-3 bg-emerald-600/10 border border-emerald-500/20 rounded-lg text-center">
          <p className="text-emerald-300/80 text-sm font-mono">
            NFT #{mintSuccess.tokenId} minted for Session #{mintSuccess.sessionId}
          </p>
        </div>
      )}

      {/* QR code */}
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

      {/* Past Sessions */}
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
                <div className="flex gap-2">
                  <Link
                    href={`/display?session=${s.id}`}
                    className="px-3 py-1.5 bg-white/5 text-white/30 rounded text-xs font-mono hover:bg-white/10 transition"
                  >
                    Recap
                  </Link>
                  {hasMintedMap[s.id] ? (
                    <span className="px-3 py-1.5 text-emerald-400/50 text-xs font-mono border border-emerald-500/15 rounded">
                      NFT minted
                    </span>
                  ) : canMintMap[s.id] ? (
                    <button
                      onClick={() => handleMintNFT(s.id)}
                      disabled={mintingSessionId === s.id}
                      className="px-3 py-1.5 bg-purple-600/20 text-purple-300/70 rounded text-xs font-mono hover:bg-purple-600/30 transition border border-purple-500/20 disabled:opacity-50"
                    >
                      {mintingSessionId === s.id ? "minting..." : "Mint NFT"}
                    </button>
                  ) : !authenticated ? (
                    <button
                      onClick={() => login()}
                      className="px-3 py-1.5 bg-purple-600/10 text-purple-300/40 rounded text-xs font-mono hover:bg-purple-600/20 transition border border-purple-500/10"
                    >
                      Mint NFT
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-white/20 text-xs font-mono">
                      NFT
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessions.length === 0 && (
        <p className="text-white/20 text-sm font-light mt-4">
          No sessions yet. Create one to get started!
        </p>
      )}

      <p className="mt-auto pt-8 text-white/15 text-xs font-mono tracking-wider">
        Powered by Monad &middot; 1s blocks &middot; Every touch is a
        transaction
      </p>
    </div>
  );
}
