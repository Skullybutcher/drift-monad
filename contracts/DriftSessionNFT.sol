// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/utils/Base64.sol";

interface IDriftComposer {
    struct Session {
        address creator;
        uint64 startBlock;
        uint64 endBlock;
        uint32 totalNotes;
        uint16 uniquePlayers;
        bool active;
    }
    function hasPlayed(uint256 sessionId, address player) external view returns (bool);
    function getSession(uint256 sessionId) external view returns (Session memory);
}

contract DriftSessionNFT is ERC721 {
    using Strings for uint256;

    // ── State ──
    IDriftComposer public immutable composer;
    string public baseAnimationUrl;
    uint256 private _nextTokenId;

    mapping(uint256 => mapping(address => uint256)) public sessionPlayerToken;
    mapping(uint256 => uint256) public tokenSession;
    mapping(uint256 => address) public tokenMinter;

    // ── Events ──
    event SessionNFTMinted(
        uint256 indexed tokenId,
        uint256 indexed sessionId,
        address indexed player
    );

    // ── Constructor ──
    constructor(
        address _composer,
        string memory _baseAnimationUrl
    ) ERC721("DRIFT Session", "DRIFT") {
        composer = IDriftComposer(_composer);
        baseAnimationUrl = _baseAnimationUrl;
        _nextTokenId = 1;
    }

    // ── Mint ──
    function mintSession(uint256 sessionId) external returns (uint256) {
        require(composer.hasPlayed(sessionId, msg.sender), "Not a participant");

        IDriftComposer.Session memory session = composer.getSession(sessionId);
        require(!session.active, "Session still active");
        require(session.startBlock > 0, "Session does not exist");
        require(sessionPlayerToken[sessionId][msg.sender] == 0, "Already minted");

        uint256 tokenId = _nextTokenId++;
        _safeMint(msg.sender, tokenId);

        sessionPlayerToken[sessionId][msg.sender] = tokenId;
        tokenSession[tokenId] = sessionId;
        tokenMinter[tokenId] = msg.sender;

        emit SessionNFTMinted(tokenId, sessionId, msg.sender);
        return tokenId;
    }

    // ── View helpers ──
    function canMint(uint256 sessionId, address player) external view returns (bool) {
        if (!composer.hasPlayed(sessionId, player)) return false;
        IDriftComposer.Session memory session = composer.getSession(sessionId);
        if (session.active || session.startBlock == 0) return false;
        if (sessionPlayerToken[sessionId][player] != 0) return false;
        return true;
    }

    function hasMinted(uint256 sessionId, address player) external view returns (bool) {
        return sessionPlayerToken[sessionId][player] != 0;
    }

    // ── tokenURI with on-chain SVG ──
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_exists(tokenId), "Token does not exist");

        uint256 sessionId = tokenSession[tokenId];
        IDriftComposer.Session memory session = composer.getSession(sessionId);
        address minter = tokenMinter[tokenId];
        bool isCreator = (minter == session.creator);

        string memory svg = _generateSVG(
            sessionId, session.totalNotes, session.uniquePlayers, isCreator, minter
        );

        string memory role = isCreator ? "Creator" : "Participant";

        string memory json = string(abi.encodePacked(
            '{"name":"DRIFT Session #', sessionId.toString(), '",',
            '"description":"A collaborative on-chain music session on Monad. Each touch is a transaction, each session is a symphony.",',
            '"image":"data:image/svg+xml;base64,', Base64.encode(bytes(svg)), '",',
            '"animation_url":"', baseAnimationUrl, sessionId.toString(), '",',
            '"attributes":[',
                _generateAttributes(sessionId, session.totalNotes, session.uniquePlayers, role),
            ']}'
        ));

        return string(abi.encodePacked(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        ));
    }

    function _generateAttributes(
        uint256 sessionId, uint32 totalNotes, uint16 uniquePlayers, string memory role
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '{"trait_type":"Session","value":', sessionId.toString(), '},',
            '{"trait_type":"Total Notes","value":', uint256(totalNotes).toString(), '},',
            '{"trait_type":"Unique Players","value":', uint256(uniquePlayers).toString(), '},',
            '{"trait_type":"Role","value":"', role, '"}'
        ));
    }

    // ── SVG Generation (split to avoid stack-too-deep) ──
    function _generateSVG(
        uint256 sessionId, uint32 totalNotes, uint16 uniquePlayers, bool isCreator, address minter
    ) internal pure returns (string memory) {
        return string(abi.encodePacked(
            _svgHeader(),
            _svgTitle(sessionId),
            _svgStats(totalNotes, uniquePlayers),
            _svgRole(isCreator),
            _svgFooter(minter)
        ));
    }

    function _svgHeader() internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" style="background:#050510">',
            '<defs>',
                '<linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">',
                    '<stop offset="0%" stop-color="#4488ff" stop-opacity="0.15"/>',
                    '<stop offset="100%" stop-color="#6644ff" stop-opacity="0.05"/>',
                '</linearGradient>',
                '<linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">',
                    '<stop offset="0%" stop-color="#4488ff" stop-opacity="0.3"/>',
                    '<stop offset="50%" stop-color="#6644ff" stop-opacity="0.5"/>',
                    '<stop offset="100%" stop-color="#22ddaa" stop-opacity="0.3"/>',
                '</linearGradient>',
            '</defs>',
            '<rect width="400" height="500" fill="url(#g1)" rx="20"/>',
            '<rect x="1" y="1" width="398" height="498" rx="19" fill="none" stroke="#ffffff10" stroke-width="1"/>',
            '<path d="M0,350 Q100,320 200,340 T400,330 L400,370 Q300,360 200,380 T0,370 Z" fill="url(#wave)" opacity="0.3"/>'
        ));
    }

    function _svgTitle(uint256 sessionId) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="200" y="70" text-anchor="middle" font-family="monospace" font-size="36" fill="#ffffffd0" letter-spacing="12">DRIFT</text>',
            '<text x="200" y="95" text-anchor="middle" font-family="monospace" font-size="10" fill="#ffffff40" letter-spacing="4">ON-CHAIN MUSIC</text>',
            '<text x="200" y="150" text-anchor="middle" font-family="monospace" font-size="14" fill="#ffffff60">SESSION</text>',
            '<text x="200" y="185" text-anchor="middle" font-family="monospace" font-size="48" fill="#4488ff" letter-spacing="2">#', sessionId.toString(), '</text>'
        ));
    }

    function _svgStats(uint32 totalNotes, uint16 uniquePlayers) internal pure returns (string memory) {
        return string(abi.encodePacked(
            '<text x="130" y="260" text-anchor="middle" font-family="monospace" font-size="10" fill="#ffffff30" letter-spacing="2">NOTES</text>',
            '<text x="130" y="290" text-anchor="middle" font-family="monospace" font-size="28" fill="#ffcc22">', uint256(totalNotes).toString(), '</text>',
            '<text x="270" y="260" text-anchor="middle" font-family="monospace" font-size="10" fill="#ffffff30" letter-spacing="2">PLAYERS</text>',
            '<text x="270" y="290" text-anchor="middle" font-family="monospace" font-size="28" fill="#ff4466">', uint256(uniquePlayers).toString(), '</text>',
            '<line x1="200" y1="245" x2="200" y2="305" stroke="#ffffff10" stroke-width="1"/>'
        ));
    }

    function _svgRole(bool isCreator) internal pure returns (string memory) {
        string memory role = isCreator ? "CREATOR" : "PARTICIPANT";
        string memory roleColor = isCreator ? "#22ddaa" : "#4488ff";
        return string(abi.encodePacked(
            '<rect x="130" y="380" width="140" height="28" rx="14" fill="', roleColor, '" fill-opacity="0.15" stroke="', roleColor, '" stroke-opacity="0.4" stroke-width="1"/>',
            '<text x="200" y="399" text-anchor="middle" font-family="monospace" font-size="11" fill="', roleColor, '" letter-spacing="3">', role, '</text>'
        ));
    }

    function _svgFooter(address minter) internal pure returns (string memory) {
        string memory shortAddr = _shortAddress(minter);
        return string(abi.encodePacked(
            '<text x="200" y="445" text-anchor="middle" font-family="monospace" font-size="10" fill="#ffffff25">', shortAddr, '</text>',
            '<text x="200" y="480" text-anchor="middle" font-family="monospace" font-size="8" fill="#ffffff15" letter-spacing="2">MONAD TESTNET</text>',
            '</svg>'
        ));
    }

    function _shortAddress(address addr) internal pure returns (string memory) {
        string memory full = Strings.toHexString(addr);
        bytes memory b = bytes(full);
        bytes memory result = new bytes(13);
        for (uint i = 0; i < 6; i++) result[i] = b[i];
        result[6] = '.';
        result[7] = '.';
        result[8] = '.';
        for (uint i = 0; i < 4; i++) result[9 + i] = b[b.length - 4 + i];
        return string(result);
    }
}
