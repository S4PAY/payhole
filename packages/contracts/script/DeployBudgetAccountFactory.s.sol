// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/console.sol";
import {DeployBase} from "./base/DeployBase.s.sol";
import {BudgetAccountFactory} from "../src/BudgetAccountFactory.sol";

/// @notice Deploys BudgetAccountFactory (and, through its constructor, the BudgetAccount implementation).
contract DeployBudgetAccountFactory is DeployBase {
    function run() external returns (address) {
        Config memory c = _config();
        _checkNetwork(c);
        address safe = _safe();
        vm.startBroadcast(_deployerKey());
        BudgetAccountFactory factory = _deployFactory(c, safe);
        vm.stopBroadcast();
        console.log("BudgetAccountFactory", address(factory));
        console.log("BudgetAccount implementation", factory.implementation());
        return address(factory);
    }
}
