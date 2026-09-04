// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";

/// @notice Test-only helper that adds a full-range position to a V4 pool from inside unlockCallback.
/// @dev Fund the seeder with both currencies before calling. The seeder owns the position.
contract LiquiditySeeder is IUnlockCallback {
    using SafeERC20 for IERC20;

    IPoolManager public immutable manager;

    error NotManager();

    constructor(IPoolManager manager_) {
        manager = manager_;
    }

    receive() external payable {}

    function seedFullRange(PoolKey memory key, uint128 liquidity) external returns (BalanceDelta delta) {
        delta = abi.decode(manager.unlock(abi.encode(key, liquidity)), (BalanceDelta));
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(manager)) revert NotManager();
        (PoolKey memory key, uint128 liquidity) = abi.decode(data, (PoolKey, uint128));
        (BalanceDelta delta,) = manager.modifyLiquidity(
            key,
            ModifyLiquidityParams({
                tickLower: TickMath.minUsableTick(key.tickSpacing),
                tickUpper: TickMath.maxUsableTick(key.tickSpacing),
                liquidityDelta: int256(uint256(liquidity)),
                salt: bytes32(0)
            }),
            ""
        );
        _pay(key.currency0, SafeCast.toUint256(-int256(delta.amount0())));
        _pay(key.currency1, SafeCast.toUint256(-int256(delta.amount1())));
        return abi.encode(delta);
    }

    function _pay(Currency currency, uint256 amount) private {
        if (amount == 0) return;
        manager.sync(currency);
        if (currency.isAddressZero()) {
            manager.settle{value: amount}();
        } else {
            IERC20(Currency.unwrap(currency)).safeTransfer(address(manager), amount);
            manager.settle();
        }
    }
}
