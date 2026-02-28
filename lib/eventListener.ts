import { CONTRACT_ADDRESS, DRIFT_ABI, getPublicClient } from "./contract";

export interface NoteEvent {
  sessionId: number;
  player: string;
  x: number;
  y: number;
  blockNum: number;
  timestamp: number;
  noteIndex: number;
  totalNotes: number;
  transactionHash: string;
}

interface NoteCreatedArgs {
  sessionId: bigint;
  player: `0x${string}`;
  x: number;
  y: number;
  blockNum: bigint;
  timestamp: bigint;
  noteIndex: number;
  totalNotesInSession: number;
}

function toNoteEvent(
  args: NoteCreatedArgs,
  txHash: string
): NoteEvent {
  return {
    sessionId: Number(args.sessionId),
    player: args.player,
    x: args.x,
    y: args.y,
    blockNum: Number(args.blockNum),
    timestamp: Number(args.timestamp),
    noteIndex: args.noteIndex,
    totalNotes: args.totalNotesInSession,
    transactionHash: txHash,
  };
}

export class DriftEventListener {
  private lastProcessedBlock: bigint = 0n;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInterval = 800;

  async startListening(sessionId: number, onNote: (note: NoteEvent) => void) {
    const client = getPublicClient();
    this.lastProcessedBlock = await client.getBlockNumber();

    this.pollTimer = setInterval(async () => {
      try {
        const currentBlock = await client.getBlockNumber();
        if (currentBlock <= this.lastProcessedBlock) return;

        const logs = await client.getContractEvents({
          address: CONTRACT_ADDRESS,
          abi: DRIFT_ABI,
          eventName: "NoteCreated",
          fromBlock: this.lastProcessedBlock + 1n,
          toBlock: currentBlock,
        });

        for (const log of logs) {
          const args = log.args as unknown as NoteCreatedArgs;
          if (!args.sessionId) continue;
          const note = toNoteEvent(args, log.transactionHash ?? "");
          if (note.sessionId === sessionId) onNote(note);
        }

        this.lastProcessedBlock = currentBlock;
      } catch (error) {
        console.error("Polling error:", error);
      }
    }, this.pollInterval);
  }

  stopListening() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Fetch all NoteCreated events for a session.
   * Uses getContractEvents with the full ABI for reliable decoding.
   * Chunks block ranges to avoid RPC limits.
   */
  async fetchAllEvents(sessionId: number): Promise<NoteEvent[]> {
    const client = getPublicClient();
    const events: NoteEvent[] = [];

    try {
      const currentBlock = await client.getBlockNumber();
      console.log("[Recap] Current block:", currentBlock.toString());

      // Get session start block from contract
      let startBlock = 0n;
      try {
        const session = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: DRIFT_ABI,
          functionName: "getSession",
          args: [BigInt(sessionId)],
        });
        console.log("[Recap] Raw session data:", session);
        // viem returns tuple as array: [creator, startBlock, endBlock, totalNotes, uniquePlayers, active]
        if (Array.isArray(session) && session[1]) {
          startBlock = BigInt(session[1]);
        } else {
          const s = session as unknown as { startBlock?: bigint };
          if (s.startBlock && s.startBlock > 0n) startBlock = s.startBlock;
        }
      } catch (e) {
        console.warn("[Recap] Could not read session:", e);
      }

      if (startBlock === 0n) {
        startBlock = currentBlock > 50000n ? currentBlock - 50000n : 0n;
      }

      console.log("[Recap] Scanning blocks", startBlock.toString(), "to", currentBlock.toString());

      const CHUNK_SIZE = 5000n;
      let from = startBlock;

      while (from <= currentBlock) {
        const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n;

        try {
          const logs = await client.getContractEvents({
            address: CONTRACT_ADDRESS,
            abi: DRIFT_ABI,
            eventName: "NoteCreated",
            fromBlock: from,
            toBlock: to,
          });

          console.log("[Recap] Chunk", from.toString(), "-", to.toString(), "→", logs.length, "logs");

          for (const log of logs) {
            const args = log.args as unknown as NoteCreatedArgs;
            if (!args.sessionId) continue;
            const note = toNoteEvent(args, log.transactionHash ?? "");
            if (note.sessionId === sessionId) {
              events.push(note);
            }
          }
        } catch (chunkError) {
          console.warn("[Recap] Chunk failed:", from.toString(), "-", to.toString(), chunkError);
        }

        from = to + 1n;
      }

      console.log("[Recap] Total events for session", sessionId, ":", events.length);

      events.sort((a, b) => {
        if (a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
        return a.noteIndex - b.noteIndex;
      });
    } catch (error) {
      console.error("[Recap] Failed:", error);
    }

    return events;
  }
}
