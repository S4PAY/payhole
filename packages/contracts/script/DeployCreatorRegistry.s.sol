// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/console.sol";
import {DeployBase} from "./base/DeployBase.s.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";

/// @notice Deploys CreatorRegistry with VERIFIER_ADDRESS as the initial verifier key.
contract DeployCreatorRegistry is DeployBase {
    function run() external returns (address) {
        Config memory c = _config();
        _checkNetwork(c);
        address safe = _safe();
        vm.startBroadcast(_deployerKey());
        CreatorRegistry registry = _deployRegistry(c, safe);
        vm.stopBroadcast();
        console.log("CreatorRegistry", address(registry));
        return address(registry);
    }
}
