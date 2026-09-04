// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {console} from "forge-std/console.sol";
import {DeployBase} from "./base/DeployBase.s.sol";
import {BurnVault} from "../src/BurnVault.sol";

/// @notice Deploys BurnVault. The token address and routes are set later by the Safe.
contract DeployBurnVault is DeployBase {
    function run() external returns (address) {
        Config memory c = _config();
        _checkNetwork(c);
        address safe = _safe();
        vm.startBroadcast(_deployerKey());
        BurnVault vault = _deployVault(c, safe);
        vm.stopBroadcast();
        console.log("BurnVault", address(vault));
        return address(vault);
    }
}
