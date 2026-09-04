// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {BudgetAccountFactory} from "../../src/BudgetAccountFactory.sol";
import {BurnVault} from "../../src/BurnVault.sol";
import {CreatorRegistry} from "../../src/CreatorRegistry.sol";

/// @notice Shared plumbing for the deploy scripts: chain config, environment, Safe checks, ownership asserts.
/// @dev Every contract is constructed with the Safe as owner, so the deployer never owns anything. Each
///      deploy helper still asserts `owner() == SAFE_ADDRESS` before returning.
abstract contract DeployBase is Script {
    uint256 internal constant CHAIN_ID = 4663;

    struct Config {
        string rpc;
        address usdg;
        address weth;
        address poolManager;
    }

    error WrongChain(uint256 chainId);
    error NotOfficialRpc(string configured);
    error ArchiveRpcForBroadcast();
    error SafeHasNoCode(address safe);
    error NotASafe(address safe);
    error OwnerMismatch(address deployed, address owner, address safe);

    function _config() internal view returns (Config memory c) {
        string memory json = vm.readFile("config/4663.json");
        c.rpc = vm.parseJsonString(json, ".rpc");
        c.usdg = vm.parseJsonAddress(json, ".usdg");
        c.weth = vm.parseJsonAddress(json, ".weth");
        c.poolManager = vm.parseJsonAddress(json, ".uniswapV4.poolManager");
    }

    /// @dev Broadcasts go through the official RPC only. The archive endpoint is for forks and reads.
    function _checkNetwork(Config memory c) internal view {
        if (block.chainid != CHAIN_ID) revert WrongChain(block.chainid);
        string memory rpc = vm.envString("RPC_URL_4663");
        if (keccak256(bytes(rpc)) != keccak256(bytes(c.rpc))) revert NotOfficialRpc(rpc);
        string memory archive = vm.envOr("ARCHIVE_RPC_URL_4663", string(""));
        if (bytes(archive).length != 0 && keccak256(bytes(rpc)) == keccak256(bytes(archive))) {
            revert ArchiveRpcForBroadcast();
        }
    }

    function _safe() internal view returns (address safe) {
        safe = vm.envAddress("SAFE_ADDRESS");
        if (safe.code.length == 0) revert SafeHasNoCode(safe);
        (bool ok, bytes memory ret) = safe.staticcall(abi.encodeWithSignature("getThreshold()"));
        if (!ok || ret.length != 32 || abi.decode(ret, (uint256)) == 0) revert NotASafe(safe);
    }

    function _deployerKey() internal view returns (uint256) {
        return vm.envUint("DEPLOYER_PRIVATE_KEY");
    }

    function _assertOwner(address deployed, address safe) internal view {
        address owner = Ownable(deployed).owner();
        if (owner != safe) revert OwnerMismatch(deployed, owner, safe);
    }

    function _deployFactory(Config memory c, address safe) internal returns (BudgetAccountFactory factory) {
        factory = new BudgetAccountFactory(c.usdg, safe);
        _assertOwner(address(factory), safe);
    }

    function _deployVault(Config memory c, address safe) internal returns (BurnVault vault) {
        vault = new BurnVault(c.poolManager, c.usdg, c.weth, safe);
        _assertOwner(address(vault), safe);
    }

    function _deployRegistry(Config memory c, address safe) internal returns (CreatorRegistry registry) {
        registry = new CreatorRegistry(c.usdg, vm.envAddress("VERIFIER_ADDRESS"), safe);
        _assertOwner(address(registry), safe);
    }
}
