// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DriftComposer {

    // ──────────────────────────────────────
    //  Types
    // ──────────────────────────────────────

    struct Session {
        uint64 startBlock;
        uint64 endBlock;
        uint32 totalNotes;
        uint16 uniquePlayers;
        bool active;
    }

    // ──────────────────────────────────────
    //  Events
    // ──────────────────────────────────────

    event NoteCreated(
        uint256 indexed sessionId,
        address indexed player,
        int16 x,
        int16 y,
        uint64 blockNum,
        uint64 timestamp,
        uint16 noteIndex,
        uint32 totalNotesInSession
    );

    event SessionStarted(uint256 indexed sessionId, uint64 startBlock);
    event SessionEnded(uint256 indexed sessionId, uint64 endBlock, uint32 totalNotes, uint16 uniquePlayers);

    // ──────────────────────────────────────
    //  State
    // ──────────────────────────────────────

    address public owner;
    uint256 public currentSessionId;

    mapping(uint256 => Session) public sessions;
    mapping(uint256 => mapping(address => bool)) public hasPlayed;
    mapping(uint256 => uint16) private playerCount;
    mapping(uint256 => mapping(uint64 => uint16)) public notesInBlock;

    // ──────────────────────────────────────
    //  Modifiers
    // ──────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier sessionActive() {
        require(sessions[currentSessionId].active, "No active session");
        _;
    }

    // ──────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ──────────────────────────────────────
    //  Core Functions
    // ──────────────────────────────────────

    function startSession() external onlyOwner {
        if (sessions[currentSessionId].active) {
            _endCurrentSession();
        }
        currentSessionId++;
        sessions[currentSessionId] = Session({
            startBlock: uint64(block.number),
            endBlock: 0,
            totalNotes: 0,
            uniquePlayers: 0,
            active: true
        });
        emit SessionStarted(currentSessionId, uint64(block.number));
    }

    function endSession() external onlyOwner {
        require(sessions[currentSessionId].active, "No active session");
        _endCurrentSession();
    }

    function touch(int16 x, int16 y) external sessionActive {
        int16 clampedX = _clamp(x, -1000, 1000);
        int16 clampedY = _clamp(y, -1000, 1000);

        Session storage session = sessions[currentSessionId];

        if (!hasPlayed[currentSessionId][msg.sender]) {
            hasPlayed[currentSessionId][msg.sender] = true;
            playerCount[currentSessionId]++;
            session.uniquePlayers = playerCount[currentSessionId];
        }

        session.totalNotes++;
        uint64 blockNum = uint64(block.number);
        notesInBlock[currentSessionId][blockNum]++;
        uint16 noteIndex = notesInBlock[currentSessionId][blockNum];

        emit NoteCreated(
            currentSessionId,
            msg.sender,
            clampedX,
            clampedY,
            blockNum,
            uint64(block.timestamp),
            noteIndex,
            session.totalNotes
        );
    }

    // ──────────────────────────────────────
    //  View Functions
    // ──────────────────────────────────────

    function getCurrentSession() external view returns (Session memory) {
        return sessions[currentSessionId];
    }

    function getBlockNoteCount(uint256 sessionId, uint64 blockNum) external view returns (uint16) {
        return notesInBlock[sessionId][blockNum];
    }

    // ──────────────────────────────────────
    //  Internal
    // ──────────────────────────────────────

    function _endCurrentSession() internal {
        Session storage session = sessions[currentSessionId];
        session.endBlock = uint64(block.number);
        session.active = false;
        emit SessionEnded(
            currentSessionId,
            uint64(block.number),
            session.totalNotes,
            session.uniquePlayers
        );
    }

    function _clamp(int16 val, int16 minVal, int16 maxVal) internal pure returns (int16) {
        if (val < minVal) return minVal;
        if (val > maxVal) return maxVal;
        return val;
    }
}
