// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Compiled under the `v4` profile (solc 0.8.26) because Uniswap's PoolManager.sol pins that version.
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BurnVaultSuite} from "../utils/BurnVaultSuite.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";
import {MockWETH9} from "../mocks/MockWETH9.sol";

contract BurnVaultLocalTest is BurnVaultSuite {
    function setUp() public {
        _setUp(IPoolManager(address(new PoolManager(address(this)))), address(new MockUSDG()), address(new MockWETH9()));
    }
}
