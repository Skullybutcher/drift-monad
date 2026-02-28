import { createPublicClient, http, type Abi } from "viem";
import { monadTestnet } from "viem/chains";

export const DRIFT_ABI = [
  // ── Events ──
  {
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
  {
    type: "event",
    name: "SessionStarted",
    inputs: [
      { name: "sessionId", type: "uint256", indexed: true },
      { name: "creator", type: "address", indexed: true },
      { name: "startBlock", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "SessionEnded",
    inputs: [
      { name: "sessionId", type: "uint256", indexed: true },
      { name: "endBlock", type: "uint64", indexed: false },
      { name: "totalNotes", type: "uint32", indexed: false },
      { name: "uniquePlayers", type: "uint16", indexed: false },
    ],
  },
  // ── Session Management ──
  {
    type: "function",
    name: "createSession",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "endSession",
    inputs: [{ name: "sessionId", type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── Core ──
  {
    type: "function",
    name: "touch",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "x", type: "int16" },
      { name: "y", type: "int16" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  // ── View Functions ──
  {
    type: "function",
    name: "nextSessionId",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getSession",
    inputs: [{ name: "sessionId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "creator", type: "address" },
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
  {
    type: "function",
    name: "isSessionActive",
    inputs: [{ name: "sessionId", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBlockNoteCount",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "blockNum", type: "uint64" },
    ],
    outputs: [{ name: "", type: "uint16" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const NFT_ABI = [
  {
    type: "event",
    name: "SessionNFTMinted",
    inputs: [
      { name: "tokenId", type: "uint256", indexed: true },
      { name: "sessionId", type: "uint256", indexed: true },
      { name: "player", type: "address", indexed: true },
    ],
  },
  {
    type: "function",
    name: "mintSession",
    inputs: [{ name: "sessionId", type: "uint256" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "canMint",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "hasMinted",
    inputs: [
      { name: "sessionId", type: "uint256" },
      { name: "player", type: "address" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "tokenURI",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
] as const satisfies Abi;

export const CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_DRIFT_CONTRACT_ADDRESS as `0x${string}`) ??
  "0x0000000000000000000000000000000000000000";

export const NFT_CONTRACT_ADDRESS =
  (process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS as `0x${string}`) ??
  "0x0000000000000000000000000000000000000000";

export const MONAD_RPC_URL =
  process.env.NEXT_PUBLIC_MONAD_RPC_URL ?? "https://testnet-rpc.monad.xyz";

export function getPublicClient() {
  return createPublicClient({
    chain: monadTestnet,
    transport: http(MONAD_RPC_URL),
  });
}
