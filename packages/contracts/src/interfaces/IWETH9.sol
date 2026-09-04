// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal wrapped-ETH interface: only the wrap side is needed by the vault.
interface IWETH9 {
    function deposit() external payable;
}
