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
   * Fetch ALL NoteCreated events from the contract's entire history.
   * Used for recap/replay.
   */
  async fetchAllEvents(): Promise<NoteEvent[]> {
    const client = getPublicClient();
    const events: NoteEvent[] = [];

    try {
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
        fromBlock: 0n,
        toBlock: "latest",
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

      // Sort by block number then note index
      events.sort((a, b) => {
        if (a.blockNum !== b.blockNum) return a.blockNum - b.blockNum;
        return a.noteIndex - b.noteIndex;
      });
    } catch (error) {
      console.error("Failed to fetch all events:", error);
    }

    return events;
  }
}
