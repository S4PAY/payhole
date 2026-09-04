// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "@openzeppelin/contracts/utils/Errors.sol";
import {BudgetAccount} from "../src/BudgetAccount.sol";
import {BudgetAccountFactory} from "../src/BudgetAccountFactory.sol";
import {OwnerSweep} from "../src/base/OwnerSweep.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract BudgetAccountFactoryTest is Test {
    MockUSDG internal usdg;
    BudgetAccountFactory internal factory;
    address internal safe = makeAddr("safe");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        usdg = new MockUSDG();
        factory = new BudgetAccountFactory(address(usdg), safe);
    }

    function test_constructor() public view {
        assertEq(factory.owner(), safe);
        assertEq(factory.usdg(), address(usdg));
        assertEq(address(BudgetAccount(payable(factory.implementation())).usdg()), address(usdg));
    }

    function test_constructor_zeroUsdgReverts() public {
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        new BudgetAccountFactory(address(0), safe);
    }

    function test_createAccount_deterministicAndOwnedByCaller() public {
        bytes32 salt = keccak256("primary");
        address predicted = factory.predictAccount(alice, salt);
        vm.expectEmit(address(factory));
        emit BudgetAccountFactory.AccountCreated(alice, predicted, salt);
        vm.prank(alice);
        address account = factory.createAccount(salt);
        assertEq(account, predicted);
        assertTrue(factory.isAccount(account));
        assertEq(BudgetAccount(payable(account)).owner(), alice);
        assertEq(BudgetAccount(payable(account)).factory(), address(factory));
    }

    function test_createAccount_sameSaltDifferentOwnersDiffer() public {
        vm.prank(alice);
        address a = factory.createAccount(bytes32(0));
        vm.prank(bob);
        address b = factory.createAccount(bytes32(0));
        assertTrue(a != b);
    }

    function test_createAccount_duplicateReverts() public {
        vm.prank(alice);
        factory.createAccount(bytes32(0));
        vm.expectRevert(Errors.FailedDeployment.selector);
        vm.prank(alice);
        factory.createAccount(bytes32(0));
    }

    function testFuzz_predictMatchesCreate(address owner_, bytes32 salt) public {
        vm.assume(owner_ != address(0));
        address predicted = factory.predictAccount(owner_, salt);
        vm.prank(owner_);
        assertEq(factory.createAccount(salt), predicted);
    }

    function test_sweep_ownerOnly() public {
        usdg.mint(address(factory), 3e6);
        vm.deal(address(factory), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        factory.sweep(address(usdg), alice, 3e6);
        vm.startPrank(safe);
        factory.sweep(address(usdg), bob, 3e6);
        factory.sweepETH(bob, 1 ether);
        vm.stopPrank();
        assertEq(usdg.balanceOf(bob), 3e6);
        assertEq(bob.balance, 1 ether);
    }

    function test_factoryOwnerCannotSweepAnAccount() public {
        vm.prank(alice);
        BudgetAccount acct = BudgetAccount(payable(factory.createAccount(bytes32(0))));
        usdg.mint(address(acct), 5e6);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        vm.prank(safe);
        acct.sweep(address(usdg), safe, 5e6);
    }
}
