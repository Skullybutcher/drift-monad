import { CONTRACT_ADDRESS, getPublicClient } from "./contract";

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

export class DriftEventListener {
  private lastProcessedBlock: bigint = 0n;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollInterval = 800; // ms — slightly less than block time

  async startListening(onNote: (note: NoteEvent) => void) {
    const client = getPublicClient();

    // Start from current block
    this.lastProcessedBlock = await client.getBlockNumber();

    this.pollTimer = setInterval(async () => {
      try {
        const currentBlock = await client.getBlockNumber();
        if (currentBlock <= this.lastProcessedBlock) return;

        const logs = await client.getLogs({
          address: CONTRACT_ADDRESS,
          event: {
            type: "event",
            name: "NoteCreated",
            inputs: [
              { name: "sessionId", type: "uint256", indexed: true },
              { name: "player", type: "address", indexed: true },
              { name: "x", type: "int16", indexed: false },
              { name: "y", type: "int16", indexed: false },
              { name: "blockNum", type: "uint64", indexed: false },
              { name: "timestamp", type: "uint64", indexed: false },
              { name: "noteIndex", type: "uint16", indexed: false },
              { name: "totalNotesInSession", type: "uint32", indexed: false },
            ],
          },
          fromBlock: this.lastProcessedBlock + 1n,
          toBlock: currentBlock,
        });

        for (const log of logs) {
          const args = log.args as {
            sessionId?: bigint;
            player?: string;
            x?: number;
            y?: number;
            blockNum?: bigint;
            timestamp?: bigint;
            noteIndex?: number;
            totalNotesInSession?: number;
          };

          if (!args.sessionId) continue;

          const noteEvent: NoteEvent = {
            sessionId: Number(args.sessionId),
            player: args.player ?? "",
            x: args.x ?? 0,
            y: args.y ?? 0,
            blockNum: Number(args.blockNum ?? 0n),
            timestamp: Number(args.timestamp ?? 0n),
            noteIndex: args.noteIndex ?? 0,
            totalNotes: args.totalNotesInSession ?? 0,
            transactionHash: log.transactionHash ?? "",
          };
          onNote(noteEvent);
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
   * Fetch ALL NoteCreated events from the contract's history.
   * Queries in chunks to avoid RPC block-range limits.
   * Used for recap/replay.
   */
  async fetchAllEvents(): Promise<NoteEvent[]> {
    const client = getPublicClient();
    const events: NoteEvent[] = [];

    const NOTE_EVENT = {
      type: "event" as const,
      name: "NoteCreated" as const,
      inputs: [
        { name: "sessionId", type: "uint256", indexed: true },
        { name: "player", type: "address", indexed: true },
        { name: "x", type: "int16", indexed: false },
        { name: "y", type: "int16", indexed: false },
        { name: "blockNum", type: "uint64", indexed: false },
        { name: "timestamp", type: "uint64", indexed: false },
        { name: "noteIndex", type: "uint16", indexed: false },
        { name: "totalNotesInSession", type: "uint32", indexed: false },
      ],
    };

    try {
      const currentBlock = await client.getBlockNumber();
      console.log("[Recap] Current block:", currentBlock.toString());

      // Try to get session start block to narrow the range
      let startBlock = 0n;
      try {
        const session = await client.readContract({
          address: CONTRACT_ADDRESS,
          abi: [
            {
              type: "function",
              name: "getCurrentSession",
              inputs: [],
              outputs: [
                {
                  name: "",
                  type: "tuple",
                  components: [
                    { name: "startBlock", type: "uint64" },
                    { name: "endBlock", type: "uint64" },
                    { name: "totalNotes", type: "uint32" },
                    { name: "uniquePlayers", type: "uint16" },
                    { name: "active", type: "bool" },
                  ],
                },
              ],
              stateMutability: "view",
            },
          ] as const,
          functionName: "getCurrentSession",
        });
        const s = session as unknown as { startBlock: bigint };
        if (s.startBlock > 0n) {
          startBlock = s.startBlock;
        }
      } catch {
        console.log("[Recap] Could not read session, scanning recent blocks");
      }

      // If no start block from contract, scan last 50,000 blocks
      if (startBlock === 0n) {
        startBlock = currentBlock > 50000n ? currentBlock - 50000n : 0n;
      }

      console.log("[Recap] Scanning from block", startBlock.toString(), "to", currentBlock.toString());

      // Query in chunks of 5000 blocks to avoid RPC limits
      const CHUNK_SIZE = 5000n;
      let from = startBlock;

      while (from <= currentBlock) {
        const to = from + CHUNK_SIZE - 1n > currentBlock ? currentBlock : from + CHUNK_SIZE - 1n;

        try {
          const logs = await client.getLogs({
            address: CONTRACT_ADDRESS,
            event: NOTE_EVENT,
            fromBlock: from,
            toBlock: to,
          });

          for (const log of logs) {
            const args = log.args as {
              sessionId?: bigint;
              player?: string;
              x?: number;
              y?: number;
              blockNum?: bigint;
              timestamp?: bigint;
              noteIndex?: number;
              totalNotesInSession?: number;
            };

            if (!args.sessionId) continue;

            events.push({
              sessionId: Number(args.sessionId),
              player: args.player ?? "",
              x: args.x ?? 0,
              y: args.y ?? 0,
              blockNum: Number(args.blockNum ?? 0n),
              timestamp: Number(args.timestamp ?? 0n),
              noteIndex: args.noteIndex ?? 0,
              totalNotes: args.totalNotesInSession ?? 0,
              transactionHash: log.transactionHash ?? "",
            });
          }
        } catch (chunkError) {
          console.warn("[Recap] Chunk failed for blocks", from.toString(), "-", to.toString(), chunkError);
        }

        from = to + 1n;
      }

      console.log("[Recap] Found", events.length, "events");

      // Sort by block number then note index
      events.sort((a, b) => {
        if (a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
        return a.noteIndex - b.noteIndex;
      });
    } catch (error) {
      console.error("[Recap] Failed to fetch events:", error);
    }

    return events;
  }
}
