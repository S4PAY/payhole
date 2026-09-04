// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice Stand-in for SwapRouter02: pulls the path's first token and mints `rate` units of the last
///         token per input unit to the recipient. Only for local plumbing tests; fork tests use the real router.
contract MockSwapRouter02 is ISwapRouter02 {
    using SafeERC20 for IERC20;

    uint256 public rate = 1000;
    bytes public lastPath;

    function setRate(uint256 rate_) external {
        rate = rate_;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut) {
        address tokenIn = address(bytes20(params.path[0:20]));
        address tokenOut = address(bytes20(params.path[params.path.length - 20:]));
        lastPath = params.path;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), params.amountIn);
        amountOut = params.amountIn * rate;
        require(amountOut >= params.amountOutMinimum, "Too little received");
        MockERC20(tokenOut).mint(params.recipient, amountOut);
    }
}
