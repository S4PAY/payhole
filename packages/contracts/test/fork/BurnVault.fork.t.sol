// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BurnVaultSuite} from "../utils/BurnVaultSuite.sol";
import {ChainConfig} from "../utils/ChainConfig.sol";

/// @notice Runs the BurnVault suite against the real PoolManager and USDG on a Robinhood Chain fork.
/// @dev Skipped unless RPC_URL_4663 is set. The $PayHole pool does not exist yet, so the suite creates
///      hookless pools with a mock token on the fork.
contract BurnVaultForkTest is BurnVaultSuite {
    function setUp() public {
        string memory rpc = vm.envOr("RPC_URL_4663", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 4663, "not Robinhood Chain");
        ChainConfig.Addresses memory a = ChainConfig.load(vm);
        _setUp(IPoolManager(a.poolManager), a.usdg);
    }
}
