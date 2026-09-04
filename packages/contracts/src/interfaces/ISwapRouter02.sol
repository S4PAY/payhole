// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice The subset of Uniswap's SwapRouter02 the vault uses: multi-hop exact-input swaps along a packed path.
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
