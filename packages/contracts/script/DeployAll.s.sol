// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/console.sol";
import {DeployBase} from "./base/DeployBase.s.sol";
import {BudgetAccountFactory} from "../src/BudgetAccountFactory.sol";
import {BurnVault} from "../src/BurnVault.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";

/// @notice Orchestrator: deploys every protocol contract in one broadcast, all owned by the Safe.
contract DeployAll is DeployBase {
    function run() external returns (address factory, address vault, address registry) {
        Config memory c = _config();
        _checkNetwork(c);
        address safe = _safe();
        vm.startBroadcast(_deployerKey());
        BudgetAccountFactory f = _deployFactory(c, safe);
        BurnVault v = _deployVault(c, safe);
        CreatorRegistry r = _deployRegistry(c, safe);
        vm.stopBroadcast();
        console.log("BudgetAccountFactory", address(f));
        console.log("BudgetAccount implementation", f.implementation());
        console.log("BurnVault", address(v));
        console.log("CreatorRegistry", address(r));
        return (address(f), address(v), address(r));
    }
}
