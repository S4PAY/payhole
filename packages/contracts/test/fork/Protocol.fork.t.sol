// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {BudgetAccount} from "../../src/BudgetAccount.sol";
import {BudgetAccountFactory} from "../../src/BudgetAccountFactory.sol";
import {CreatorRegistry} from "../../src/CreatorRegistry.sol";
import {ChainConfig} from "../utils/ChainConfig.sol";

/// @notice Budget accounts and the registry moving real USDG on a Robinhood Chain fork.
contract ProtocolForkTest is Test {
    IERC20 internal usdg;
    BudgetAccountFactory internal factory;
    CreatorRegistry internal registry;
    BudgetAccount internal acct;

    address internal safe = makeAddr("safe");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal key = makeAddr("key");
    address internal site = makeAddr("site");
    address internal creator = makeAddr("creator");
    address internal verifier;
    uint256 internal verifierPk;

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        ChainConfig.Addresses memory a = ChainConfig.load(vm);
        usdg = IERC20(a.usdg);
        (verifier, verifierPk) = makeAddrAndKey("verifier");
        factory = new BudgetAccountFactory(a.usdg, safe);
        registry = new CreatorRegistry(a.usdg, verifier, safe);
        deal(a.usdg, alice, 1000e6);
        vm.startPrank(alice);
        acct = BudgetAccount(payable(factory.createAccount(bytes32(0))));
        usdg.approve(address(acct), type(uint256).max);
        usdg.approve(address(registry), type(uint256).max);
        acct.deposit(500e6);
        vm.stopPrank();
    }

    function test_realUsdg_budgetFlow() public {
        assertEq(usdg.balanceOf(address(acct)), 500e6);
        vm.startPrank(alice);
        acct.setGlobalCap(100e6);
        acct.setSessionKey(key, 20e6, block.timestamp + 1 days);
        acct.setSiteCap(site, 10e6);
        acct.fund(site, 4e6);
        vm.stopPrank();
        vm.prank(key);
        acct.pay(bob, 15e6);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.KeyCapExceeded.selector, 5e6));
        vm.prank(key);
        acct.pay(bob, 6e6);
        vm.prank(alice);
        acct.withdraw(alice, 1e6);
        assertEq(usdg.balanceOf(site), 4e6);
        assertEq(usdg.balanceOf(bob), 15e6);
        assertEq(usdg.balanceOf(alice), 501e6);
        assertEq(usdg.balanceOf(address(acct)), 480e6);
    }

    function test_realUsdg_tip() public {
        bytes32 domainHash = keccak256("example.com");
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierPk, registry.claimDigest(domainHash, creator, deadline));
        registry.claim(domainHash, creator, deadline, abi.encodePacked(r, s, v));
        vm.prank(alice);
        registry.tip(domainHash, 0.05e6);
        assertEq(usdg.balanceOf(creator), 0.05e6);
        assertEq(usdg.balanceOf(address(registry)), 0);
    }
}
