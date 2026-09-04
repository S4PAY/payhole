// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BudgetAccount} from "../src/BudgetAccount.sol";
import {BudgetAccountFactory} from "../src/BudgetAccountFactory.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

/// @dev Drives one account through random owner and key actions while checking, per call, that a
///      payment succeeds only when it fits the live key's remaining allowance and the global cap.
contract BudgetAccountHandler is Test {
    BudgetAccount public acct;
    MockUSDG public usdg;
    address public owner;
    address[] public keys;
    address[] public sites;

    uint256 public totalPaid;
    uint256 public totalFunded;
    uint256 public totalWithdrawn;
    uint256 public totalDeposited;
    uint256 public revokeAlls;

    constructor(BudgetAccount acct_, MockUSDG usdg_, address owner_) {
        acct = acct_;
        usdg = usdg_;
        owner = owner_;
        for (uint256 i; i < 4; i++) {
            keys.push(vm.addr(100 + i));
            sites.push(vm.addr(200 + i));
        }
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, 1000e6);
        usdg.mint(owner, amount);
        vm.startPrank(owner);
        usdg.approve(address(acct), amount);
        acct.deposit(amount);
        vm.stopPrank();
        totalDeposited += amount;
    }

    function withdraw(uint256 amount) external {
        uint256 bal = usdg.balanceOf(address(acct));
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(owner);
        acct.withdraw(owner, amount);
        totalWithdrawn += amount;
    }

    function setGlobalCap(uint96 cap) external {
        vm.prank(owner);
        acct.setGlobalCap(cap);
    }

    function setSessionKey(uint256 idx, uint96 cap, uint40 ttl) external {
        cap = uint96(bound(cap, 1, type(uint96).max));
        ttl = uint40(bound(ttl, 1, 30 days));
        vm.prank(owner);
        acct.setSessionKey(keys[idx % keys.length], cap, block.timestamp + ttl);
    }

    function revokeSessionKey(uint256 idx) external {
        vm.prank(owner);
        acct.revokeSessionKey(keys[idx % keys.length]);
    }

    function revokeAll() external {
        vm.prank(owner);
        acct.revokeAll();
        revokeAlls += 1;
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 3 days));
    }

    function pay(uint256 idx, uint96 amount) external {
        address key = keys[idx % keys.length];
        amount = uint96(bound(amount, 0, 2000e6));
        bool live = acct.isSessionKeyLive(key);
        uint256 allowance = acct.remainingForKey(key);
        uint256 bal = usdg.balanceOf(address(acct));
        bool shouldSucceed = live && amount > 0 && amount <= allowance && amount <= bal;
        vm.prank(key);
        try acct.pay(key, amount) {
            assertTrue(shouldSucceed, "pay succeeded outside allowance");
            totalPaid += amount;
        } catch {
            assertFalse(shouldSucceed, "pay reverted inside allowance");
        }
    }

    function setSiteCap(uint256 idx, uint128 cap) external {
        vm.prank(owner);
        acct.setSiteCap(sites[idx % sites.length], cap);
    }

    function fund(uint256 idx, uint128 amount) external {
        address site = sites[idx % sites.length];
        amount = uint128(bound(amount, 0, 2000e6));
        uint256 remaining = acct.siteRemaining(site);
        uint256 bal = usdg.balanceOf(address(acct));
        bool shouldSucceed = amount > 0 && amount <= remaining && amount <= bal;
        vm.prank(owner);
        try acct.fund(site, amount) {
            assertTrue(shouldSucceed, "fund succeeded over site cap");
            totalFunded += amount;
        } catch {
            assertFalse(shouldSucceed, "fund reverted under site cap");
        }
    }

    function keyCount() external view returns (uint256) {
        return keys.length;
    }
}

contract BudgetAccountInvariantTest is Test {
    MockUSDG internal usdg;
    BudgetAccountFactory internal factory;
    BudgetAccount internal acct;
    BudgetAccountHandler internal handler;
    address internal alice = makeAddr("alice");

    function setUp() public {
        usdg = new MockUSDG();
        factory = new BudgetAccountFactory(address(usdg), makeAddr("safe"));
        vm.prank(alice);
        acct = BudgetAccount(payable(factory.createAccount(bytes32(0))));
        handler = new BudgetAccountHandler(acct, usdg, alice);
        targetContract(address(handler));
    }

    function invariant_globalSpentEqualsEverythingPaidByKeys() public view {
        assertEq(acct.globalSpent(), handler.totalPaid());
    }

    function invariant_balanceMatchesLedger() public view {
        uint256 expected =
            handler.totalDeposited() - handler.totalPaid() - handler.totalFunded() - handler.totalWithdrawn();
        assertEq(usdg.balanceOf(address(acct)), expected);
    }

    function invariant_noKeyOutlivesItsEpoch() public view {
        uint24 epoch = acct.epoch();
        for (uint256 i; i < handler.keyCount(); i++) {
            BudgetAccount.SessionKey memory k = acct.sessionKey(handler.keys(i));
            if (k.cap != 0 && k.epoch != epoch) {
                assertFalse(acct.isSessionKeyLive(handler.keys(i)));
                assertEq(acct.remainingForKey(handler.keys(i)), 0);
            }
        }
    }

    function invariant_ownerUnchanged() public view {
        assertEq(acct.owner(), alice);
    }
}
