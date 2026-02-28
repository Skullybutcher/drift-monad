// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DriftComposer {

    // ──────────────────────────────────────
    //  Types
    // ──────────────────────────────────────

    struct Session {
        address creator;
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

    event SessionStarted(uint256 indexed sessionId, address indexed creator, uint64 startBlock);
    event SessionEnded(uint256 indexed sessionId, uint64 endBlock, uint32 totalNotes, uint16 uniquePlayers);

    // ──────────────────────────────────────
    //  Constants
    // ──────────────────────────────────────

    uint256 public constant MAX_SESSION_BLOCKS = 43200; // ~12 hours at 1s blocks

    // ──────────────────────────────────────
    //  State
    // ──────────────────────────────────────

    address public owner;
    uint256 public nextSessionId;

    mapping(uint256 => Session) public sessions;
    mapping(uint256 => mapping(address => bool)) public hasPlayed;
    mapping(uint256 => uint16) private playerCount;
    mapping(uint256 => mapping(uint64 => uint16)) public notesInBlock;

    // ──────────────────────────────────────
    //  Constructor
    // ──────────────────────────────────────

    constructor() {
        owner = msg.sender;
    }

    // ──────────────────────────────────────
    //  Session Management (anyone can create)
    // ──────────────────────────────────────

    function createSession() external returns (uint256) {
        nextSessionId++;
        sessions[nextSessionId] = Session({
            creator: msg.sender,
            startBlock: uint64(block.number),
            endBlock: 0,
            totalNotes: 0,
            uniquePlayers: 0,
            active: true
        });
        emit SessionStarted(nextSessionId, msg.sender, uint64(block.number));
        return nextSessionId;
    }

    function endSession(uint256 sessionId) external {
        Session storage session = sessions[sessionId];
        require(session.active, "Not active");
        require(msg.sender == session.creator || msg.sender == owner, "Not authorized");
        _endSession(sessionId);
    }

    // ──────────────────────────────────────
    //  Core Touch Function
    // ──────────────────────────────────────

    function touch(uint256 sessionId, int16 x, int16 y) external {
        Session storage session = sessions[sessionId];
        require(session.active, "Session not active");
        require(
            block.number <= session.startBlock + MAX_SESSION_BLOCKS,
            "Session expired"
        );

        int16 clampedX = _clamp(x, -1000, 1000);
        int16 clampedY = _clamp(y, -1000, 1000);

        if (!hasPlayed[sessionId][msg.sender]) {
            hasPlayed[sessionId][msg.sender] = true;
            playerCount[sessionId]++;
            session.uniquePlayers = playerCount[sessionId];
        }

        session.totalNotes++;
        uint64 blockNum = uint64(block.number);
        notesInBlock[sessionId][blockNum]++;
        uint16 noteIndex = notesInBlock[sessionId][blockNum];

        emit NoteCreated(
            sessionId,
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

    function getSession(uint256 sessionId) external view returns (Session memory) {
        return sessions[sessionId];
    }

    function isSessionActive(uint256 sessionId) external view returns (bool) {
        Session storage session = sessions[sessionId];
        return session.active && block.number <= session.startBlock + MAX_SESSION_BLOCKS;
    }

    function getBlockNoteCount(uint256 sessionId, uint64 blockNum) external view returns (uint16) {
        return notesInBlock[sessionId][blockNum];
    }

    // ──────────────────────────────────────
    //  Internal
    // ──────────────────────────────────────

    function _endSession(uint256 sessionId) internal {
        Session storage session = sessions[sessionId];
        session.endBlock = uint64(block.number);
        session.active = false;
        emit SessionEnded(
            sessionId,
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
