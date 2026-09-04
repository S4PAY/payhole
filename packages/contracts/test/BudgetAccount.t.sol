// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BudgetAccount} from "../src/BudgetAccount.sol";
import {BudgetAccountFactory} from "../src/BudgetAccountFactory.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract BudgetAccountTest is Test {
    MockUSDG internal usdg;
    BudgetAccountFactory internal factory;
    BudgetAccount internal acct;

    address internal safe = makeAddr("safe");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal key1 = makeAddr("key1");
    address internal key2 = makeAddr("key2");
    address internal site1 = makeAddr("site1");

    uint256 internal constant DEPOSIT = 10_000e6;

    function setUp() public {
        usdg = new MockUSDG();
        factory = new BudgetAccountFactory(address(usdg), safe);
        vm.prank(alice);
        acct = BudgetAccount(payable(factory.createAccount(bytes32(0))));
        usdg.mint(alice, 1_000_000e6);
        vm.startPrank(alice);
        usdg.approve(address(acct), type(uint256).max);
        acct.deposit(DEPOSIT);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ lifecycle

    function test_initialize_onlyFactory() public {
        vm.expectRevert(BudgetAccount.NotFactory.selector);
        acct.initialize(bob);
    }

    function test_initialize_onlyOnce() public {
        vm.expectRevert(BudgetAccount.AlreadyInitialized.selector);
        vm.prank(address(factory));
        acct.initialize(bob);
    }

    function test_implementation_isLockedToFactory() public {
        BudgetAccount impl = BudgetAccount(payable(factory.implementation()));
        vm.expectRevert(BudgetAccount.NotFactory.selector);
        impl.initialize(bob);
        assertEq(impl.owner(), address(0));
        assertEq(impl.factory(), address(factory));
    }

    function test_setUp_state() public view {
        assertEq(acct.owner(), alice);
        assertEq(address(acct.usdg()), address(usdg));
        assertEq(usdg.balanceOf(address(acct)), DEPOSIT);
        assertEq(acct.epoch(), 0);
    }

    // --------------------------------------------------------------- budget

    function test_deposit_anyoneCanTopUp() public {
        usdg.mint(bob, 5e6);
        vm.startPrank(bob);
        usdg.approve(address(acct), 5e6);
        vm.expectEmit(address(acct));
        emit BudgetAccount.Deposited(bob, 5e6);
        acct.deposit(5e6);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(acct)), DEPOSIT + 5e6);
    }

    function test_deposit_zeroReverts() public {
        vm.expectRevert(BudgetAccount.ZeroAmount.selector);
        acct.deposit(0);
    }

    function test_withdraw_owner() public {
        vm.prank(alice);
        acct.withdraw(bob, 1000e6);
        assertEq(usdg.balanceOf(bob), 1000e6);
        assertEq(usdg.balanceOf(address(acct)), DEPOSIT - 1000e6);
    }

    function test_withdraw_notOwnerReverts() public {
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        vm.prank(bob);
        acct.withdraw(bob, 1);
    }

    function test_withdraw_moreThanBalanceReverts() public {
        vm.expectRevert();
        vm.prank(alice);
        acct.withdraw(bob, DEPOSIT + 1);
    }

    // ------------------------------------------------------- session keys

    function _key(address key, uint256 cap, uint256 ttl) internal {
        vm.prank(alice);
        acct.setSessionKey(key, cap, block.timestamp + ttl);
    }

    function _global(uint256 cap) internal {
        vm.prank(alice);
        acct.setGlobalCap(cap);
    }

    function test_setSessionKey_validation() public {
        vm.startPrank(alice);
        vm.expectRevert(BudgetAccount.ZeroAddress.selector);
        acct.setSessionKey(address(0), 1, block.timestamp + 1);
        vm.expectRevert(BudgetAccount.ZeroAmount.selector);
        acct.setSessionKey(key1, 0, block.timestamp + 1);
        vm.expectRevert(BudgetAccount.InvalidExpiry.selector);
        acct.setSessionKey(key1, 1, block.timestamp);
        vm.stopPrank();
    }

    function test_setSessionKey_notOwnerReverts() public {
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        vm.prank(key1);
        acct.setSessionKey(key1, 1e6, block.timestamp + 1);
    }

    function test_pay_withinCap() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        vm.expectEmit(address(acct));
        emit BudgetAccount.Paid(key1, bob, 60e6);
        vm.prank(key1);
        acct.pay(bob, 60e6);
        assertEq(usdg.balanceOf(bob), 60e6);
        assertEq(acct.sessionKey(key1).spent, 60e6);
        assertEq(acct.globalSpent(), 60e6);
        assertEq(acct.remainingForKey(key1), 40e6);
    }

    function test_pay_exceedingKeyCapReverts() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        vm.prank(key1);
        acct.pay(bob, 60e6);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.KeyCapExceeded.selector, 40e6));
        vm.prank(key1);
        acct.pay(bob, 40e6 + 1);
        vm.prank(key1);
        acct.pay(bob, 40e6);
        assertEq(acct.remainingForKey(key1), 0);
    }

    function test_pay_unknownKeyReverts() public {
        _global(1000e6);
        vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(key1);
        acct.pay(bob, 1);
    }

    function test_pay_ownerIsNotASessionKey() public {
        _global(1000e6);
        vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(alice);
        acct.pay(bob, 1);
    }

    function test_pay_keyCanPayItself() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        vm.prank(key1);
        acct.pay(key1, 25e6);
        assertEq(usdg.balanceOf(key1), 25e6);
    }

    function test_pay_expiryBoundary() public {
        _global(1000e6);
        uint256 expiry = block.timestamp + 1 hours;
        vm.prank(alice);
        acct.setSessionKey(key1, 100e6, expiry);
        vm.warp(expiry);
        vm.prank(key1);
        acct.pay(bob, 1e6);
        vm.warp(expiry + 1);
        assertFalse(acct.isSessionKeyLive(key1));
        vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(key1);
        acct.pay(bob, 1e6);
    }

    function test_revokeSessionKey_failsImmediately() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        vm.prank(key1);
        acct.pay(bob, 1e6);
        vm.expectEmit(address(acct));
        emit BudgetAccount.SessionKeyRevoked(key1);
        vm.prank(alice);
        acct.revokeSessionKey(key1);
        assertFalse(acct.isSessionKeyLive(key1));
        assertEq(acct.remainingForKey(key1), 0);
        vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(key1);
        acct.pay(bob, 1);
    }

    function test_revokeAll_killsEveryKeyInOneTx() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        _key(key2, 100e6, 1 days);
        vm.expectEmit(address(acct));
        emit BudgetAccount.AllSessionKeysRevoked(1);
        vm.prank(alice);
        acct.revokeAll();
        assertEq(acct.epoch(), 1);
        assertFalse(acct.isSessionKeyLive(key1));
        assertFalse(acct.isSessionKeyLive(key2));
        vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(key1);
        acct.pay(bob, 1);
        vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(key2);
        acct.pay(bob, 1);
    }

    function test_revokeAll_newEpochKeysWorkAndOldKeyReissueResetsSpent() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        vm.prank(key1);
        acct.pay(bob, 70e6);
        vm.prank(alice);
        acct.revokeAll();
        _key(key1, 50e6, 1 days);
        BudgetAccount.SessionKey memory k = acct.sessionKey(key1);
        assertEq(k.spent, 0);
        assertEq(k.epoch, 1);
        vm.prank(key1);
        acct.pay(bob, 50e6);
        assertEq(acct.globalSpent(), 120e6);
    }

    function test_setSessionKey_updateKeepsSpent() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        vm.prank(key1);
        acct.pay(bob, 30e6);
        _key(key1, 40e6, 2 days);
        assertEq(acct.sessionKey(key1).spent, 30e6);
        assertEq(acct.remainingForKey(key1), 10e6);
        _key(key1, 20e6, 2 days);
        assertEq(acct.remainingForKey(key1), 0);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.KeyCapExceeded.selector, 0));
        vm.prank(key1);
        acct.pay(bob, 1);
    }

    function test_globalCap_holdsAcrossKeys() public {
        _global(100e6);
        _key(key1, 80e6, 1 days);
        _key(key2, 80e6, 1 days);
        vm.prank(key1);
        acct.pay(bob, 70e6);
        assertEq(acct.remainingForKey(key2), 30e6);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.GlobalCapExceeded.selector, 30e6));
        vm.prank(key2);
        acct.pay(bob, 31e6);
        vm.prank(key2);
        acct.pay(bob, 30e6);
        assertEq(acct.globalSpent(), 100e6);
        assertEq(acct.remainingForKey(key1), 0);
    }

    function test_setGlobalCap_belowSpentBlocksAllKeysUntilRaised() public {
        _global(100e6);
        _key(key1, 100e6, 1 days);
        vm.prank(key1);
        acct.pay(bob, 60e6);
        _global(50e6);
        assertEq(acct.remainingForKey(key1), 0);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.GlobalCapExceeded.selector, 0));
        vm.prank(key1);
        acct.pay(bob, 1);
        _global(70e6);
        vm.prank(key1);
        acct.pay(bob, 10e6);
        assertEq(acct.globalSpent(), 70e6);
    }

    function test_globalCap_defaultZeroBlocksPayments() public {
        _key(key1, 100e6, 1 days);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.GlobalCapExceeded.selector, 0));
        vm.prank(key1);
        acct.pay(bob, 1);
    }

    function test_pay_zeroAddressAndAmountRevert() public {
        _global(100e6);
        _key(key1, 100e6, 1 days);
        vm.expectRevert(BudgetAccount.ZeroAddress.selector);
        vm.prank(key1);
        acct.pay(address(0), 1);
        vm.expectRevert(BudgetAccount.ZeroAmount.selector);
        vm.prank(key1);
        acct.pay(bob, 0);
    }

    // ------------------------------------------------------------ fuzzing

    function testFuzz_keyCapNeverExceeded(uint96 cap, uint96[8] memory amounts) public {
        cap = uint96(bound(cap, 1, 5000e6));
        _global(type(uint96).max);
        _key(key1, cap, 1 days);
        uint256 spent;
        for (uint256 i; i < amounts.length; i++) {
            uint256 amt = bound(amounts[i], 1, 2000e6);
            uint256 remaining = cap - spent;
            if (amt > remaining) {
                vm.expectRevert(abi.encodeWithSelector(BudgetAccount.KeyCapExceeded.selector, remaining));
                vm.prank(key1);
                acct.pay(bob, amt);
            } else {
                vm.prank(key1);
                acct.pay(bob, amt);
                spent += amt;
            }
        }
        assertLe(spent, cap);
        assertEq(acct.sessionKey(key1).spent, spent);
        assertEq(usdg.balanceOf(bob), spent);
        assertEq(acct.remainingForKey(key1), cap - spent);
    }

    function testFuzz_globalCapHoldsAcrossKeys(uint96 globalCap, uint96[16] memory amounts, uint8[16] memory which)
        public
    {
        globalCap = uint96(bound(globalCap, 1, 8000e6));
        address[4] memory keys = [key1, key2, makeAddr("key3"), makeAddr("key4")];
        _global(globalCap);
        for (uint256 i; i < keys.length; i++) {
            _key(keys[i], type(uint96).max, 1 days);
        }
        uint256 total;
        for (uint256 i; i < amounts.length; i++) {
            address k = keys[which[i] % keys.length];
            uint256 amt = bound(amounts[i], 1, 3000e6);
            uint256 remaining = globalCap - total;
            if (amt > remaining) {
                vm.expectRevert(abi.encodeWithSelector(BudgetAccount.GlobalCapExceeded.selector, remaining));
                vm.prank(k);
                acct.pay(bob, amt);
            } else {
                vm.prank(k);
                acct.pay(bob, amt);
                total += amt;
            }
        }
        assertLe(total, globalCap);
        assertEq(acct.globalSpent(), total);
        assertEq(usdg.balanceOf(bob), total);
    }

    function testFuzz_payBoundedByBothCaps(uint96 keyCap, uint96 globalCap, uint96 amt) public {
        keyCap = uint96(bound(keyCap, 1, DEPOSIT));
        globalCap = uint96(bound(globalCap, 1, DEPOSIT));
        amt = uint96(bound(amt, 1, DEPOSIT));
        _global(globalCap);
        _key(key1, keyCap, 1 days);
        uint256 allowed = keyCap < globalCap ? keyCap : globalCap;
        assertEq(acct.remainingForKey(key1), allowed);
        if (amt > keyCap) {
            vm.expectRevert(abi.encodeWithSelector(BudgetAccount.KeyCapExceeded.selector, keyCap));
        } else if (amt > globalCap) {
            vm.expectRevert(abi.encodeWithSelector(BudgetAccount.GlobalCapExceeded.selector, globalCap));
        }
        vm.prank(key1);
        acct.pay(bob, amt);
        assertLe(usdg.balanceOf(bob), allowed);
    }

    function testFuzz_revokeAllKillsEveryKey(uint8 n) public {
        n = uint8(bound(n, 1, 32));
        _global(type(uint96).max);
        address[] memory keys = new address[](n);
        vm.startPrank(alice);
        for (uint256 i; i < n; i++) {
            keys[i] = vm.addr(1000 + i);
            acct.setSessionKey(keys[i], 1e6, block.timestamp + 1 days);
        }
        acct.revokeAll();
        vm.stopPrank();
        assertEq(acct.epoch(), 1);
        for (uint256 i; i < n; i++) {
            assertFalse(acct.isSessionKeyLive(keys[i]));
            vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
            vm.prank(keys[i]);
            acct.pay(bob, 1);
        }
    }

    function testFuzz_revokedKeyFailsImmediately(uint96 cap, uint96 firstSpend) public {
        cap = uint96(bound(cap, 2, 5000e6));
        firstSpend = uint96(bound(firstSpend, 1, cap - 1));
        _global(type(uint96).max);
        _key(key1, cap, 1 days);
        vm.prank(key1);
        acct.pay(bob, firstSpend);
        vm.prank(alice);
        acct.revokeSessionKey(key1);
        vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(key1);
        acct.pay(bob, 1);
        assertEq(usdg.balanceOf(bob), firstSpend);
    }

    function testFuzz_expiry(uint40 ttl, uint40 elapsed) public {
        ttl = uint40(bound(ttl, 1, 365 days));
        elapsed = uint40(bound(elapsed, 0, 2 * 365 days));
        _global(type(uint96).max);
        uint256 start = block.timestamp;
        _key(key1, 1e6, ttl);
        vm.warp(start + elapsed);
        bool live = elapsed <= ttl;
        assertEq(acct.isSessionKeyLive(key1), live);
        if (!live) vm.expectRevert(BudgetAccount.InvalidSessionKey.selector);
        vm.prank(key1);
        acct.pay(bob, 1);
    }

    // ------------------------------------------------- per-site addresses

    function test_fund_underCap() public {
        vm.startPrank(alice);
        acct.setSiteCap(site1, 20e6);
        vm.expectEmit(address(acct));
        emit BudgetAccount.SiteFunded(site1, 15e6);
        acct.fund(site1, 15e6);
        vm.stopPrank();
        assertEq(usdg.balanceOf(site1), 15e6);
        assertEq(acct.siteRemaining(site1), 5e6);
        assertEq(acct.siteInfo(site1).funded, 15e6);
    }

    function test_fund_overCapReverts() public {
        vm.startPrank(alice);
        acct.setSiteCap(site1, 20e6);
        acct.fund(site1, 15e6);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.SiteCapExceeded.selector, 5e6));
        acct.fund(site1, 5e6 + 1);
        acct.fund(site1, 5e6);
        vm.stopPrank();
        assertEq(acct.siteRemaining(site1), 0);
    }

    function test_fund_noCapSetReverts() public {
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.SiteCapExceeded.selector, 0));
        vm.prank(alice);
        acct.fund(site1, 1);
    }

    function test_setSiteCap_belowFundedBlocksFurtherFunding() public {
        vm.startPrank(alice);
        acct.setSiteCap(site1, 20e6);
        acct.fund(site1, 15e6);
        acct.setSiteCap(site1, 10e6);
        assertEq(acct.siteRemaining(site1), 0);
        vm.expectRevert(abi.encodeWithSelector(BudgetAccount.SiteCapExceeded.selector, 0));
        acct.fund(site1, 1);
        acct.setSiteCap(site1, 16e6);
        acct.fund(site1, 1e6);
        vm.stopPrank();
        assertEq(usdg.balanceOf(site1), 16e6);
    }

    function test_fund_onlyOwner() public {
        _global(1000e6);
        _key(key1, 100e6, 1 days);
        vm.prank(alice);
        acct.setSiteCap(site1, 20e6);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        vm.prank(key1);
        acct.fund(site1, 1e6);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        vm.prank(bob);
        acct.setSiteCap(site1, 1e6);
    }

    function testFuzz_siteCapNeverExceeded(uint128 cap, uint128[8] memory amounts) public {
        cap = uint128(bound(cap, 0, 9000e6));
        vm.prank(alice);
        acct.setSiteCap(site1, cap);
        uint256 funded;
        for (uint256 i; i < amounts.length; i++) {
            uint256 amt = bound(amounts[i], 1, 4000e6);
            uint256 remaining = cap - funded;
            vm.prank(alice);
            if (amt > remaining) {
                vm.expectRevert(abi.encodeWithSelector(BudgetAccount.SiteCapExceeded.selector, remaining));
                acct.fund(site1, amt);
            } else {
                acct.fund(site1, amt);
                funded += amt;
            }
        }
        assertLe(funded, cap);
        assertEq(usdg.balanceOf(site1), funded);
        assertEq(acct.siteRemaining(site1), cap - funded);
    }

    // ---------------------------------------------------------------- sweep

    function test_sweep_recoversStuckTokenAndEth() public {
        MockUSDG other = new MockUSDG();
        other.mint(address(acct), 7e6);
        vm.deal(address(acct), 1 ether);
        vm.startPrank(alice);
        acct.sweep(address(other), bob, 7e6);
        acct.sweepETH(bob, 0.4 ether);
        vm.stopPrank();
        assertEq(other.balanceOf(bob), 7e6);
        assertEq(bob.balance, 0.4 ether);
        assertEq(address(acct).balance, 0.6 ether);
    }

    function test_sweep_notOwnerReverts() public {
        vm.deal(address(acct), 1 ether);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        vm.prank(bob);
        acct.sweep(address(usdg), bob, 1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        vm.prank(bob);
        acct.sweepETH(bob, 1);
    }

    function test_protocolOwnerHasNoPowerOverAccounts() public {
        vm.deal(address(acct), 1 ether);
        vm.startPrank(safe);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.withdraw(safe, 1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.sweep(address(usdg), safe, 1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.sweepETH(safe, 1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.setSessionKey(safe, 1, block.timestamp + 1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.setGlobalCap(1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.setSiteCap(safe, 1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.fund(safe, 1);
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.revokeAll();
        vm.stopPrank();
        vm.startPrank(address(factory));
        vm.expectRevert(BudgetAccount.NotOwner.selector);
        acct.withdraw(safe, 1);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(acct)), DEPOSIT);
        assertEq(address(acct).balance, 1 ether);
    }
}
