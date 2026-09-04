// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {BudgetAccount} from "./BudgetAccount.sol";
import {OwnerSweep} from "./base/OwnerSweep.sol";

/// @title BudgetAccountFactory
/// @notice Deploys {BudgetAccount} minimal proxies at deterministic addresses.
/// @dev The factory owner can only recover tokens sent to the factory itself and has no power over
///      any account. Accounts are always owned by the caller of {createAccount}.
contract BudgetAccountFactory is OwnerSweep {
    /// @notice Implementation every account delegates to.
    address public immutable implementation;
    /// @notice USDG token baked into the implementation.
    address public immutable usdg;

    /// @notice True for every account this factory created.
    mapping(address account => bool) public isAccount;

    event AccountCreated(address indexed owner, address indexed account, bytes32 salt);

    /// @param usdg_ Address of the USDG token.
    /// @param initialOwner Owner of the factory (the protocol Safe). Only used for sweeps.
    constructor(address usdg_, address initialOwner) Ownable(initialOwner) {
        if (usdg_ == address(0)) revert ZeroAddress();
        usdg = usdg_;
        implementation = address(new BudgetAccount(usdg_));
    }

    /// @notice Create an account owned by the caller at `predictAccount(msg.sender, salt)`.
    /// @param salt Caller-chosen salt; lets one owner hold several accounts.
    /// @return account Address of the new account.
    function createAccount(bytes32 salt) external returns (address account) {
        account = Clones.cloneDeterministic(implementation, _salt(msg.sender, salt));
        isAccount[account] = true;
        BudgetAccount(payable(account)).initialize(msg.sender);
        emit AccountCreated(msg.sender, account, salt);
    }

    /// @notice Address {createAccount} produces for `owner_` and `salt`.
    /// @param owner_ Future account owner.
    /// @param salt Salt the owner will use.
    function predictAccount(address owner_, bytes32 salt) external view returns (address) {
        return Clones.predictDeterministicAddress(implementation, _salt(owner_, salt), address(this));
    }

    function _salt(address owner_, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode(owner_, salt));
    }
}
