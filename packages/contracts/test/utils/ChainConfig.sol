// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";

/// @notice External contract addresses for Robinhood Chain, read from config/4663.json.
library ChainConfig {
    struct Addresses {
        address usdg;
        address weth;
        address poolManager;
        address v4Quoter;
        address permit2;
    }

    function load(Vm vm) internal view returns (Addresses memory a) {
        string memory json = vm.readFile("config/4663.json");
        a.usdg = vm.parseJsonAddress(json, ".usdg");
        a.weth = vm.parseJsonAddress(json, ".weth");
        a.poolManager = vm.parseJsonAddress(json, ".uniswapV4.poolManager");
        a.v4Quoter = vm.parseJsonAddress(json, ".uniswapV4.quoter");
        a.permit2 = vm.parseJsonAddress(json, ".uniswapV4.permit2");
    }
}
