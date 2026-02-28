"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, type WalletClient } from "viem";
import { monadTestnet } from "viem/chains";
import { DRIFT_ABI, CONTRACT_ADDRESS } from "@/lib/contract";

const TOUCH_COOLDOWN = 1000; // 1 second between touches

export default function PlayPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { ready, authenticated, login } = usePrivy();
  const { wallets } = useWallets();
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [showHint, setShowHint] = useState(true);
  const lastTouchRef = useRef(0);
  const rippleCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  // Auto-login on mount
  useEffect(() => {
    if (ready && !authenticated) {
      login();
    }
  }, [ready, authenticated, login]);

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
      } catch (err) {
        console.error("Wallet setup error:", err);
      }
    }
    setup();
  }, [wallets]);

  // Fade out hint after 3 seconds
  useEffect(() => {
    const timer = setTimeout(() => setShowHint(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // Setup canvas for ripples
  useEffect(() => {
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
  }, []);

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
      const x = Math.round(((clientX - rect.left) / rect.width) * 2000 - 1000);
      const y = Math.round(((clientY - rect.top) / rect.height) * 2000 - 1000);

      // Local ripple immediately
      createLocalRipple(clientX - rect.left, clientY - rect.top);

      // Fire-and-forget transaction
      try {
        const [account] = await walletClient.getAddresses();
        await walletClient.writeContract({
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
