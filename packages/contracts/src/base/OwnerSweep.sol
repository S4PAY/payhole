// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @title OwnerSweep
/// @notice Owner-only recovery of ERC-20 tokens and ETH that end up in a protocol contract.
/// @dev Shared by every protocol contract except BudgetAccount, whose funds belong to its user and
///      can only be moved by that user.
abstract contract OwnerSweep is Ownable {
    using SafeERC20 for IERC20;

    /// @notice Emitted when the owner recovers tokens or ETH. `token` is the zero address for ETH.
    event Swept(address indexed token, address indexed to, uint256 amount);

    error ZeroAddress();

    /// @notice Transfer `amount` of `token` held by this contract to `to`.
    /// @param token ERC-20 token to recover.
    /// @param to Recipient of the tokens.
    /// @param amount Amount in the token's base units.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    /// @notice Transfer `amount` wei held by this contract to `to`.
    /// @param to Recipient of the ETH.
    /// @param amount Amount in wei.
    function sweepETH(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        Address.sendValue(payable(to), amount);
        emit Swept(address(0), to, amount);
    }
}
