"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import {
  createWalletClient,
  createPublicClient,
  custom,
  http,
  formatEther,
  type WalletClient,
} from "viem";
import { monadTestnet } from "viem/chains";
import { DRIFT_ABI, CONTRACT_ADDRESS, MONAD_RPC_URL } from "@/lib/contract";

const TOUCH_COOLDOWN = 1000; // 1 second between touches

export default function PlayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [balance, setBalance] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [copied, setCopied] = useState(false);
  const lastTouchRef = useRef(0);
  const rippleCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Setup wallet client once wallet is available
  useEffect(() => {
    async function setup() {
      if (wallets.length === 0) return;
      const wallet = wallets[0];
      try {
        await wallet.switchChain(10143);
        const provider = await wallet.getEthereumProvider();
        const client = createWalletClient({
          chain: monadTestnet,
          transport: custom(provider),
        });
        setWalletClient(client);
        setIsConnecting(false);

        // Get address
        const [addr] = await client.getAddresses();
        setWalletAddress(addr);

        // Fetch balance
        const publicClient = createPublicClient({
          chain: monadTestnet,
          transport: http(MONAD_RPC_URL),
        });
        const bal = await publicClient.getBalance({ address: addr });
        setBalance(formatEther(bal));

        // Show hint once wallet is ready
        setShowHint(true);
        setTimeout(() => setShowHint(false), 3000);
      } catch (err) {
        console.error("Wallet setup error:", err);
        setIsConnecting(false);
      }
    }
    setup();
  }, [wallets]);

  // Poll balance every 10s
  useEffect(() => {
    if (!walletAddress) return;
    const publicClient = createPublicClient({
      chain: monadTestnet,
      transport: http(MONAD_RPC_URL),
    });
    const interval = setInterval(async () => {
      try {
        const bal = await publicClient.getBalance({
          address: walletAddress as `0x${string}`,
        });
        setBalance(formatEther(bal));
      } catch {}
    }, 10000);
    return () => clearInterval(interval);
  }, [walletAddress]);

  // Setup canvas for ripples
  useEffect(() => {
    if (!authenticated || !walletClient) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    rippleCtxRef.current = canvas.getContext("2d");

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [authenticated, walletClient]);

  const createLocalRipple = useCallback((px: number, py: number) => {
    const ctx = rippleCtxRef.current;
    if (!ctx) return;

    let radius = 0;
    let opacity = 0.6;

    const animate = () => {
      radius += 2;
      opacity -= 0.015;
      if (opacity <= 0) return;

      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(100, 180, 255, ${opacity})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      requestAnimationFrame(animate);
    };
    animate();
  }, []);

  const handleTouch = useCallback(
    async (e: React.PointerEvent) => {
      const now = Date.now();
      if (now - lastTouchRef.current < TOUCH_COOLDOWN) return;
      lastTouchRef.current = now;

      if (!walletClient || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const clientX = e.clientX;
      const clientY = e.clientY;

      // Normalize to -1000..+1000
      const x = Math.round(
        ((clientX - rect.left) / rect.width) * 2000 - 1000
      );
      const y = Math.round(
        ((clientY - rect.top) / rect.height) * 2000 - 1000
      );

      // Local ripple immediately
      createLocalRipple(clientX - rect.left, clientY - rect.top);

      // Fire-and-forget transaction
      try {
        const [account] = await walletClient.getAddresses();
        walletClient.writeContract({
          address: CONTRACT_ADDRESS,
          abi: DRIFT_ABI,
          functionName: "touch",
          args: [x, y],
          account,
          chain: monadTestnet,
        });
      } catch (err) {
        console.error("Transaction failed:", err);
      }
    },
    [walletClient, createLocalRipple]
  );

  const handleLogin = async () => {
    setIsConnecting(true);
    try {
      login();
    } catch (err) {
      console.error("Login error:", err);
      setIsConnecting(false);
    }
  };

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : "";

  const hasBalance = balance && parseFloat(balance) > 0;

  // State 1: Loading Privy
  if (!ready) {
    return (
      <div className="fixed inset-0 gradient-drift flex items-center justify-center">
        <div className="text-white/30 text-lg font-light tracking-[0.3em] animate-pulse">
          loading...
        </div>
      </div>
    );
  }

  // State 2: Not logged in — show login button
  if (!authenticated) {
    return (
      <div className="fixed inset-0 gradient-drift flex flex-col items-center justify-center gap-8">
        <h1 className="text-white/60 text-3xl font-extralight tracking-[0.4em]">
          DRIFT
        </h1>
        <button
          onClick={handleLogin}
          disabled={isConnecting}
          className="px-8 py-4 bg-white/10 hover:bg-white/20 text-white/70 rounded-xl text-lg font-light tracking-wider transition-all border border-white/10 hover:border-white/20 disabled:opacity-50"
        >
          {isConnecting ? "connecting..." : "tap to join"}
        </button>
        <p className="text-white/20 text-xs font-light tracking-wider">
          creates a wallet automatically
        </p>
      </div>
    );
  }

  // State 3: Logged in but wallet not ready yet
  if (!walletClient) {
    return (
      <div className="fixed inset-0 gradient-drift flex items-center justify-center">
        <div className="text-white/30 text-lg font-light tracking-[0.3em] animate-pulse">
          setting up wallet...
        </div>
      </div>
    );
  }

  // State 4: Wallet ready but no balance — show fund prompt
  if (!hasBalance) {
    return (
      <div className="fixed inset-0 gradient-drift flex flex-col items-center justify-center gap-6 px-6">
        <h1 className="text-white/60 text-2xl font-extralight tracking-[0.3em]">
          DRIFT
        </h1>
        <p className="text-white/40 text-sm font-light text-center">
          Your wallet needs testnet MON to play.
          <br />
          Send MON to your address:
        </p>
        <button
          onClick={copyAddress}
          className="px-4 py-3 bg-white/10 hover:bg-white/15 rounded-lg font-mono text-sm text-white/70 transition-all border border-white/10 break-all max-w-xs text-center"
        >
          {copied ? "copied!" : walletAddress}
        </button>
        <div className="text-white/25 text-xs font-mono">
          Balance: {balance ? parseFloat(balance).toFixed(4) : "0"} MON
        </div>
        <a
          href="https://faucet.monad.xyz"
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white/60 rounded-lg text-sm font-light tracking-wider transition-all border border-white/10"
        >
          Get testnet MON
        </a>
        <p className="text-white/20 text-xs font-light text-center max-w-xs">
          Once funded, this page will update automatically
        </p>
      </div>
    );
  }

  // State 5: Ready — show touch canvas
  return (
    <div className="fixed inset-0 overflow-hidden touch-none select-none">
      {/* Animated gradient background */}
      <div className="absolute inset-0 gradient-drift" />

      {/* Canvas for ripple effects */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full z-10"
        onPointerDown={handleTouch}
      />

      {/* Wallet info — top, subtle */}
      <div className="absolute top-4 left-0 right-0 flex justify-center pointer-events-none z-20">
        <div className="text-white/15 font-mono text-xs">
          {shortAddress} &middot; {parseFloat(balance!).toFixed(4)} MON
        </div>
      </div>

      {/* Hint text — fades out */}
      {showHint && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <p className="text-white/20 text-lg font-light tracking-[0.3em] animate-fade-out">
            touch anywhere
          </p>
        </div>
      )}
    </div>
  );
}
