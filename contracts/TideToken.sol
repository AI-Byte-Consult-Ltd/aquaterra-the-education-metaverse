// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Tide (TIDE) on Cronos: the AquaTerra World coin outside the game.
/// @notice NOT DEPLOYED. Withdrawals stay switched off (token_enabled = 0 in
/// aquaterra_exchange_params) until the legal review. When it is cleared:
///  1. deploy this contract with the bridge wallet as `bridge`;
///  2. save its address in /admin (setting token_contract);
///  3. a bridge worker mints queued rows of aquaterra_token_withdrawals and marks them sent;
///  4. to come back into the game, a holder calls `bridgeBack`: the coins burn and the
///     worker credits the in-game wallet from 'bridge:cronos' (event BridgedBack).
/// Supply on chain can never exceed the Tide locked in 'bridge:cronos'.
contract TideToken {
    string public constant name = "Tide";
    string public constant symbol = "TIDE";
    uint8 public constant decimals = 0; // whole Tide, as in the game

    uint256 public totalSupply;
    address public bridge;
    address public pendingBridge;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event BridgedOut(address indexed to, uint256 value, uint256 indexed withdrawalId);
    event BridgedBack(address indexed from, uint256 value, string citizen);
    event BridgeChanged(address indexed bridge);

    error NotBridge();
    error Insufficient();
    error ZeroAddress();

    constructor(address bridge_) {
        if (bridge_ == address(0)) revert ZeroAddress();
        bridge = bridge_;
        emit BridgeChanged(bridge_);
    }

    modifier onlyBridge() {
        if (msg.sender != bridge) revert NotBridge();
        _;
    }

    /// Mint Tide that left the game; `withdrawalId` is the row in aquaterra_token_withdrawals.
    function bridgeOut(address to, uint256 value, uint256 withdrawalId) external onlyBridge {
        if (to == address(0)) revert ZeroAddress();
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
        emit BridgedOut(to, value, withdrawalId);
    }

    /// Burn Tide to bring them back into the game. `citizen` is the in-game citizen name.
    function bridgeBack(uint256 value, string calldata citizen) external {
        if (balanceOf[msg.sender] < value) revert Insufficient();
        unchecked { balanceOf[msg.sender] -= value; }
        totalSupply -= value;
        emit Transfer(msg.sender, address(0), value);
        emit BridgedBack(msg.sender, value, citizen);
    }

    /// Two-step hand-over of the bridge key.
    function proposeBridge(address next) external onlyBridge {
        pendingBridge = next;
    }

    function acceptBridge() external {
        if (msg.sender != pendingBridge) revert NotBridge();
        bridge = pendingBridge;
        pendingBridge = address(0);
        emit BridgeChanged(bridge);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _move(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert Insufficient();
            unchecked { allowance[from][msg.sender] = allowed - value; }
        }
        _move(from, to, value);
        return true;
    }

    function _move(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        if (balanceOf[from] < value) revert Insufficient();
        unchecked {
            balanceOf[from] -= value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
