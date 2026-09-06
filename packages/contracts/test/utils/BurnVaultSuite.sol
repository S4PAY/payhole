// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {FullMath} from "@uniswap/v4-core/src/libraries/FullMath.sol";
import {LiquidityAmounts} from "@uniswap/v4-core/test/utils/LiquidityAmounts.sol";
import {BurnVault} from "../../src/BurnVault.sol";
import {IWETH9} from "../../src/interfaces/IWETH9.sol";
import {OwnerSweep} from "../../src/base/OwnerSweep.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {LiquiditySeeder} from "./LiquiditySeeder.sol";

/// @notice The full BurnVault test suite, parameterised by PoolManager, USDG, and WETH so it runs both
///         against a locally deployed PoolManager and on a Robinhood Chain fork.
abstract contract BurnVaultSuite is Test {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IPoolManager internal manager;
    IERC20 internal usdg;
    IERC20 internal weth;
    MockERC20 internal payhole;
    BurnVault internal vault;
    LiquiditySeeder internal seeder;

    address internal safe = makeAddr("safe");
    address internal user = makeAddr("user");
    address internal keeper = makeAddr("keeper");

    PoolKey internal usdgPool; // USDG / PAYHOLE
    PoolKey internal ethPool; // native ETH / PAYHOLE
    PoolKey internal wethPool; // WETH / PAYHOLE
    PoolKey internal usdgEthPool; // USDG / native ETH

    address internal router;

    function _setUp(IPoolManager manager_, address usdg_, address weth_, address router_) internal {
        router = router_;
        manager = manager_;
        usdg = IERC20(usdg_);
        weth = IERC20(weth_);
        payhole = new MockERC20("PayHole", "PAYHOLE", 18);
        seeder = new LiquiditySeeder(manager);
        vault = new BurnVault(address(manager), router_, usdg_, weth_, safe);

        usdgPool = _poolKey(usdg_, address(payhole), 3000, 60);
        ethPool = _poolKey(address(0), address(payhole), 3000, 60);
        wethPool = _poolKey(weth_, address(payhole), 3000, 60);
        // Deliberately unusual fee tier so the fork run never collides with a live USDG/ETH pool.
        usdgEthPool = _poolKey(usdg_, address(0), 7777, 77);
        // 1 USDG = 1000 PAYHOLE, 1 ETH = 3_000_000 PAYHOLE, 1 ETH = 3000 USDG
        _initAndSeed(usdgPool, usdg_, 200_000e6, 200_000_000e18);
        _initAndSeed(ethPool, address(0), 100 ether, 300_000_000e18);
        _initAndSeed(wethPool, weth_, 100 ether, 300_000_000e18);
        _initAndSeed(usdgEthPool, usdg_, 300_000e6, 100 ether);

        _fund(usdg_, user, 1_000_000e6);
        vm.deal(user, 1000 ether);
        vm.prank(user);
        usdg.approve(address(vault), type(uint256).max);
    }

    function _configureNative() internal {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRoute(address(usdg), _route(usdgPool));
        vault.setRoute(address(0), _route(ethPool));
        vm.stopPrank();
    }

    function _configureWeth() internal {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRoute(address(usdg), _route(usdgPool));
        vault.setRoute(address(0), _route(wethPool));
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ helpers

    function _fund(address token, address to, uint256 amount) internal virtual {
        if (token == address(0)) {
            vm.deal(to, to.balance + amount);
        } else if (token == address(weth)) {
            vm.deal(to, to.balance + amount);
            vm.prank(to);
            IWETH9(token).deposit{value: amount}();
        } else {
            deal(token, to, IERC20(token).balanceOf(to) + amount);
        }
    }

    function _sqrtPriceX96(uint256 amount0, uint256 amount1) internal pure returns (uint160) {
        return SafeCast.toUint160(Math.sqrt(FullMath.mulDiv(amount1, 1 << 192, amount0)));
    }

    function _poolKey(address a, address b, uint24 fee, int24 spacing) internal pure returns (PoolKey memory) {
        (address c0, address c1) = a < b ? (a, b) : (b, a);
        return PoolKey(Currency.wrap(c0), Currency.wrap(c1), fee, spacing, IHooks(address(0)));
    }

    function _initAndSeed(PoolKey memory k, address tokenA, uint256 amtA, uint256 amtB) internal {
        (uint256 amt0, uint256 amt1) = Currency.unwrap(k.currency0) == tokenA ? (amtA, amtB) : (amtB, amtA);
        uint160 sqrtP = _sqrtPriceX96(amt0, amt1);
        manager.initialize(k, sqrtP);
        uint128 liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(TickMath.minUsableTick(k.tickSpacing)),
            TickMath.getSqrtPriceAtTick(TickMath.maxUsableTick(k.tickSpacing)),
            amt0,
            amt1
        );
        _fund(Currency.unwrap(k.currency0), address(seeder), amt0 + 1e6);
        _fund(Currency.unwrap(k.currency1), address(seeder), amt1 + 1e6);
        seeder.seedFullRange(k, liquidity);
    }

    function _route(PoolKey memory a) internal pure returns (PoolKey[] memory r) {
        r = new PoolKey[](1);
        r[0] = a;
    }

    function _route(PoolKey memory a, PoolKey memory b) internal pure returns (PoolKey[] memory r) {
        r = new PoolKey[](2);
        r[0] = a;
        r[1] = b;
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 5 minutes;
    }

    function _assertVaultEmpty() internal view {
        assertEq(usdg.balanceOf(address(vault)), 0, "usdg left in vault");
        assertEq(weth.balanceOf(address(vault)), 0, "weth left in vault");
        assertEq(payhole.balanceOf(address(vault)), 0, "payhole left in vault");
        assertEq(address(vault).balance, 0, "eth left in vault");
    }

    // ------------------------------------------------------------ configuration

    function test_constructor() public view {
        assertEq(vault.owner(), safe);
        assertEq(address(vault.poolManager()), address(manager));
        assertEq(address(vault.usdg()), address(usdg));
        assertEq(address(vault.weth()), address(weth));
        assertEq(address(vault.swapRouter()), router);
        assertEq(vault.token(), address(0));
        assertFalse(vault.ethRouteUsesWeth());
        assertEq(uint8(vault.routeKind(address(usdg))), uint8(BurnVault.RouteKind.None));
    }

    function test_constructor_zeroAddressesRevert() public {
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        new BurnVault(address(0), router, address(usdg), address(weth), safe);
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        new BurnVault(address(manager), address(0), address(usdg), address(weth), safe);
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        new BurnVault(address(manager), router, address(0), address(weth), safe);
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        new BurnVault(address(manager), router, address(usdg), address(0), safe);
    }

    function test_setToken_onceAndOwnerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        vault.setToken(address(payhole));
        vm.startPrank(safe);
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        vault.setToken(address(0));
        vm.expectEmit(address(vault));
        emit BurnVault.TokenSet(address(payhole));
        vault.setToken(address(payhole));
        vm.expectRevert(BurnVault.TokenAlreadySet.selector);
        vault.setToken(address(payhole));
        vm.stopPrank();
        assertEq(vault.token(), address(payhole));
    }

    function test_setRoute_validation() public {
        PoolKey[] memory none = new PoolKey[](0);
        PoolKey[] memory three = new PoolKey[](3);
        vm.startPrank(safe);
        vm.expectRevert(BurnVault.TokenNotSet.selector);
        vault.setRoute(address(usdg), _route(usdgPool));
        vault.setToken(address(payhole));
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRoute(address(usdg), none);
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRoute(address(usdg), three);
        // path that does not start at the input
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRoute(address(usdg), _route(ethPool));
        // path that does not end at the token
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRoute(address(usdg), _route(usdgEthPool));
        // ETH route that starts in neither a native nor a WETH pool
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRoute(address(0), _route(usdgPool));
        // unsupported input
        vm.expectRevert(abi.encodeWithSelector(BurnVault.UnsupportedToken.selector, address(payhole)));
        vault.setRoute(address(payhole), _route(usdgPool));
        vm.expectEmit(address(vault));
        emit BurnVault.RouteSet(address(usdg), 2, false);
        vault.setRoute(address(usdg), _route(usdgEthPool, ethPool));
        assertEq(vault.route(address(usdg)).length, 2);
        assertEq(uint8(vault.routeKind(address(usdg))), uint8(BurnVault.RouteKind.V4));
        vault.setRoute(address(usdg), _route(usdgPool));
        assertEq(vault.route(address(usdg)).length, 1);
        assertEq(Currency.unwrap(vault.route(address(usdg))[0].currency0), Currency.unwrap(usdgPool.currency0));
        vm.stopPrank();
    }

    function test_setRoute_ethNativeOrWeth() public {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vm.expectEmit(address(vault));
        emit BurnVault.RouteSet(address(0), 1, false);
        vault.setRoute(address(0), _route(ethPool));
        assertFalse(vault.ethRouteUsesWeth());
        vm.expectEmit(address(vault));
        emit BurnVault.RouteSet(address(0), 1, true);
        vault.setRoute(address(0), _route(wethPool));
        assertTrue(vault.ethRouteUsesWeth());
        // two hops starting native: ETH -> USDG -> PAYHOLE
        vault.setRoute(address(0), _route(usdgEthPool, usdgPool));
        assertFalse(vault.ethRouteUsesWeth());
        assertEq(vault.route(address(0)).length, 2);
        vm.stopPrank();
    }

    function test_setRoute_ownerOnly() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        vault.setRoute(address(usdg), _route(usdgPool));
    }

    function test_setTierPrice() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        vault.setTierPrice(1, 10e6);
        vm.startPrank(safe);
        vm.expectRevert(BurnVault.InvalidTier.selector);
        vault.setTierPrice(0, 10e6);
        vm.expectEmit(address(vault));
        emit BurnVault.TierPriceSet(1, 10e6);
        vault.setTierPrice(1, 10e6);
        vm.stopPrank();
        assertEq(vault.tierPrice(1), 10e6);
    }

    // ------------------------------------------------------------------- swaps

    function test_burnWith_usdgSingleHop() public {
        _configureNative();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.expectEmit(true, true, false, false, address(vault));
        emit BurnVault.Burned(user, address(usdg), 100e6, 0);
        vm.prank(user);
        uint256 burned = vault.burnWith(address(usdg), 100e6, 0, _deadline());
        // about 1000 PAYHOLE per USDG minus fee and impact
        assertGt(burned, 99_000e18);
        assertLt(burned, 100_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        assertEq(usdg.balanceOf(user), 1_000_000e6 - 100e6);
        _assertVaultEmpty();
    }

    function test_burnWith_ethNativeRoute() public {
        _configureNative();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        uint256 wethSupplyBefore = weth.totalSupply();
        vm.prank(user);
        uint256 burned = vault.burnWith{value: 1 ether}(address(0), 1 ether, 0, _deadline());
        assertGt(burned, 2_900_000e18);
        assertLt(burned, 3_000_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        assertEq(user.balance, 999 ether);
        assertEq(weth.totalSupply(), wethSupplyBefore, "native route must not wrap");
        _assertVaultEmpty();
    }

    function test_burnWith_ethViaWethRoute() public {
        _configureWeth();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        uint256 wethSupplyBefore = weth.totalSupply();
        vm.prank(user);
        uint256 burned = vault.burnWith{value: 1 ether}(address(0), 1 ether, 0, _deadline());
        assertGt(burned, 2_900_000e18);
        assertLt(burned, 3_000_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        assertEq(user.balance, 999 ether);
        assertEq(weth.totalSupply(), wethSupplyBefore + 1 ether, "weth route wraps the input");
        _assertVaultEmpty();
    }

    function test_burnWith_usdgTwoHopsViaNativeEth() public {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRoute(address(usdg), _route(usdgEthPool, ethPool));
        vm.stopPrank();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith(address(usdg), 300e6, 0, _deadline());
        // 300 USDG -> about 0.1 ETH -> about 300_000 PAYHOLE, minus two fees
        assertGt(burned, 290_000e18);
        assertLt(burned, 300_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        _assertVaultEmpty();
    }

    function test_burnWith_ethTwoHopsViaUsdg() public {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRoute(address(0), _route(usdgEthPool, usdgPool));
        vm.stopPrank();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith{value: 0.1 ether}(address(0), 0.1 ether, 0, _deadline());
        // 0.1 ETH -> about 300 USDG -> about 300_000 PAYHOLE, minus two fees
        assertGt(burned, 290_000e18);
        assertLt(burned, 300_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        _assertVaultEmpty();
    }

    function test_burnWith_slippageEnforced() public {
        _configureNative();
        uint256 snapshot = vm.snapshotState();
        vm.prank(user);
        uint256 quote = vault.burnWith(address(usdg), 100e6, 0, _deadline());
        vm.revertToState(snapshot);
        vm.expectRevert(abi.encodeWithSelector(BurnVault.InsufficientOutput.selector, quote, quote + 1));
        vm.prank(user);
        vault.burnWith(address(usdg), 100e6, quote + 1, _deadline());
        vm.prank(user);
        assertEq(vault.burnWith(address(usdg), 100e6, quote, _deadline()), quote);
    }

    function test_burnWith_deadline() public {
        _configureNative();
        vm.expectRevert(BurnVault.Expired.selector);
        vm.prank(user);
        vault.burnWith(address(usdg), 1e6, 0, block.timestamp - 1);
    }

    function test_burnWith_inputValidation() public {
        _configureNative();
        vm.startPrank(user);
        vm.expectRevert(BurnVault.ZeroAmount.selector);
        vault.burnWith(address(usdg), 0, 0, _deadline());
        vm.expectRevert(BurnVault.ValueMismatch.selector);
        vault.burnWith{value: 1}(address(usdg), 1e6, 0, _deadline());
        vm.expectRevert(BurnVault.ValueMismatch.selector);
        vault.burnWith{value: 1 ether}(address(0), 2 ether, 0, _deadline());
        vm.expectRevert(abi.encodeWithSelector(BurnVault.UnsupportedToken.selector, address(payhole)));
        vault.burnWith(address(payhole), 1e18, 0, _deadline());
        vm.expectRevert(abi.encodeWithSelector(BurnVault.UnsupportedToken.selector, address(weth)));
        vault.burnWith(address(weth), 1e18, 0, _deadline());
        vm.stopPrank();
    }

    function test_burnWith_beforeTokenOrRouteReverts() public {
        vm.expectRevert(BurnVault.TokenNotSet.selector);
        vm.prank(user);
        vault.burnWith(address(usdg), 1e6, 0, _deadline());
        vm.prank(safe);
        vault.setToken(address(payhole));
        vm.expectRevert(BurnVault.RouteNotSet.selector);
        vm.prank(user);
        vault.burnWith(address(usdg), 1e6, 0, _deadline());
        vm.expectRevert(BurnVault.RouteNotSet.selector);
        vm.prank(user);
        vault.burnWith{value: 1 ether}(address(0), 1 ether, 0, _deadline());
    }

    function test_unlockCallback_onlyPoolManager() public {
        vm.expectRevert(BurnVault.NotPoolManager.selector);
        vault.unlockCallback("");
    }

    function testFuzz_burnWith_usdg(uint96 amount) public {
        amount = uint96(bound(amount, 1e3, 50_000e6));
        _configureNative();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith(address(usdg), amount, 0, _deadline());
        assertGt(burned, 0);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        _assertVaultEmpty();
    }

    function testFuzz_burnWith_ethNative(uint96 amount) public {
        amount = uint96(bound(amount, 1e9, 20 ether));
        _configureNative();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith{value: amount}(address(0), amount, 0, _deadline());
        assertGt(burned, 0);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        _assertVaultEmpty();
    }

    function testFuzz_burnWith_ethViaWeth(uint96 amount) public {
        amount = uint96(bound(amount, 1e9, 20 ether));
        _configureWeth();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith{value: amount}(address(0), amount, 0, _deadline());
        assertGt(burned, 0);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        _assertVaultEmpty();
    }

    // --------------------------------------------------------------- held funds

    function test_burnHeld_ownerOnly() public {
        _configureNative();
        vm.prank(user);
        assertTrue(usdg.transfer(address(vault), 50e6));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, keeper));
        vm.prank(keeper);
        vault.burnHeld(address(usdg), 0, _deadline());
        assertEq(usdg.balanceOf(address(vault)), 50e6);
    }

    function test_burnHeld_usdg() public {
        _configureNative();
        vm.prank(user);
        assertTrue(usdg.transfer(address(vault), 50e6));
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.expectEmit(true, true, false, false, address(vault));
        emit BurnVault.Burned(safe, address(usdg), 50e6, 0);
        vm.prank(safe);
        uint256 burned = vault.burnHeld(address(usdg), 0, _deadline());
        assertGt(burned, 49_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        _assertVaultEmpty();
    }

    function test_burnHeld_ethNativeRoute() public {
        _configureNative();
        vm.prank(user);
        (bool ok,) = address(vault).call{value: 2 ether}("");
        assertTrue(ok);
        assertEq(address(vault).balance, 2 ether);
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.prank(safe);
        uint256 burned = vault.burnHeld(address(0), 0, _deadline());
        assertGt(burned, 5_800_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        _assertVaultEmpty();
    }

    function test_burnHeld_ethViaWethRoute() public {
        _configureWeth();
        vm.prank(user);
        (bool ok,) = address(vault).call{value: 2 ether}("");
        assertTrue(ok);
        uint256 deadBefore = payhole.balanceOf(DEAD);
        uint256 wethSupplyBefore = weth.totalSupply();
        vm.prank(safe);
        uint256 burned = vault.burnHeld(address(0), 0, _deadline());
        assertGt(burned, 5_800_000e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        assertEq(weth.totalSupply(), wethSupplyBefore + 2 ether);
        _assertVaultEmpty();
    }

    function test_burnHeld_payholeForwardedWithoutSwap() public {
        _configureNative();
        payhole.mint(address(vault), 123e18);
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.expectEmit(address(vault));
        emit BurnVault.Burned(safe, address(payhole), 123e18, 123e18);
        vm.prank(safe);
        assertEq(vault.burnHeld(address(payhole), 0, _deadline()), 123e18);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, 123e18);
    }

    function test_burnHeld_validation() public {
        _configureNative();
        vm.startPrank(safe);
        vm.expectRevert(BurnVault.ZeroAmount.selector);
        vault.burnHeld(address(usdg), 0, _deadline());
        vm.expectRevert(BurnVault.ZeroAmount.selector);
        vault.burnHeld(address(0), 0, _deadline());
        vm.expectRevert(BurnVault.ZeroAmount.selector);
        vault.burnHeld(address(payhole), 0, _deadline());
        vm.expectRevert(abi.encodeWithSelector(BurnVault.UnsupportedToken.selector, address(0xBEEF)));
        vault.burnHeld(address(0xBEEF), 0, _deadline());
        vm.expectRevert(BurnVault.Expired.selector);
        vault.burnHeld(address(usdg), 0, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_burnHeld_payholeBeforeTokenSetIsUnsupported() public {
        payhole.mint(address(vault), 1e18);
        vm.expectRevert(abi.encodeWithSelector(BurnVault.UnsupportedToken.selector, address(payhole)));
        vm.prank(safe);
        vault.burnHeld(address(payhole), 0, _deadline());
    }

    // ------------------------------------------------------------- direct burns

    function test_burnDirect() public {
        vm.expectRevert(BurnVault.TokenNotSet.selector);
        vault.burnDirect(1e18);
        vm.prank(safe);
        vault.setToken(address(payhole));
        payhole.mint(user, 10e18);
        vm.startPrank(user);
        payhole.approve(address(vault), type(uint256).max);
        vm.expectRevert(BurnVault.ZeroAmount.selector);
        vault.burnDirect(0);
        vm.expectEmit(address(vault));
        emit BurnVault.Burned(user, address(payhole), 4e18, 4e18);
        vault.burnDirect(4e18);
        vm.stopPrank();
        assertEq(payhole.balanceOf(DEAD), 4e18);
        assertEq(payhole.balanceOf(user), 6e18);
        assertEq(payhole.balanceOf(address(vault)), 0);
    }

    // ------------------------------------------------------------------- tiers

    function test_unlock_buysAndBurnsWithRoute() public {
        _configureNative();
        vm.startPrank(safe);
        vault.setTierPrice(1, 10e6);
        vault.setTierPrice(2, 50e6);
        vm.stopPrank();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.startPrank(user);
        vm.expectEmit(true, true, false, false, address(vault));
        emit BurnVault.Burned(user, address(usdg), 10e6, 0);
        vm.expectEmit(true, false, false, false, address(vault));
        emit BurnVault.Unlocked(user, 1, 10e6, 0);
        uint256 burned = vault.unlock(1, 9_000e18, _deadline());
        // about 1000 PAYHOLE per USDG minus fee and impact
        assertGt(burned, 9_900e18);
        assertLt(burned, 10_000e18);
        assertEq(vault.tierOf(user), 1);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        vm.expectRevert(abi.encodeWithSelector(BurnVault.TierNotHigher.selector, 1));
        vault.unlock(1, 0, _deadline());
        vm.expectRevert(abi.encodeWithSelector(BurnVault.TierNotConfigured.selector, 3));
        vault.unlock(3, 0, _deadline());
        uint256 burnedMore = vault.unlock(2, 45_000e18, _deadline());
        vm.stopPrank();
        assertGt(burnedMore, burned * 4);
        assertEq(vault.tierOf(user), 2);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned + burnedMore);
        assertEq(usdg.balanceOf(user), 1_000_000e6 - 60e6);
        _assertVaultEmpty();
    }

    function test_unlock_holdsUsdgUntilRouteExistsThenBurnHeld() public {
        vm.prank(safe);
        vault.setTierPrice(1, 10e6);
        vm.expectEmit(address(vault));
        emit BurnVault.Unlocked(user, 1, 10e6, 0);
        vm.prank(user);
        uint256 burned = vault.unlock(1, 0, _deadline());
        assertEq(burned, 0);
        assertEq(vault.tierOf(user), 1);
        assertEq(usdg.balanceOf(address(vault)), 10e6);
        assertEq(usdg.balanceOf(user), 1_000_000e6 - 10e6);
        assertEq(payhole.balanceOf(DEAD), 0);

        _configureNative();
        vm.prank(safe);
        uint256 burnedLater = vault.burnHeld(address(usdg), 9_000e18, _deadline());
        assertGt(burnedLater, 9_900e18);
        assertEq(payhole.balanceOf(DEAD), burnedLater);
        _assertVaultEmpty();
    }

    function test_unlock_slippageAndDeadline() public {
        _configureNative();
        vm.prank(safe);
        vault.setTierPrice(1, 10e6);
        vm.startPrank(user);
        vm.expectRevert(BurnVault.Expired.selector);
        vault.unlock(1, 0, block.timestamp - 1);
        vm.expectRevert();
        vault.unlock(1, 10_001e18, _deadline());
        vm.stopPrank();
        assertEq(vault.tierOf(user), 0);
        assertEq(usdg.balanceOf(user), 1_000_000e6);
    }

    function test_unlock_requiresPriceAndApproval() public {
        vm.expectRevert(abi.encodeWithSelector(BurnVault.TierNotConfigured.selector, 1));
        vm.prank(user);
        vault.unlock(1, 0, _deadline());
        vm.prank(safe);
        vault.setTierPrice(1, 10e6);
        // keeper holds no USDG and gave no approval
        vm.expectRevert();
        vm.prank(keeper);
        vault.unlock(1, 0, _deadline());
        assertEq(vault.tierOf(keeper), 0);
        assertEq(vault.tierOf(user), 0);
    }

    // ------------------------------------------------------------------- sweep

    function test_sweep_recoversStuckTokenAndEth() public {
        MockERC20 stray = new MockERC20("Stray", "STR", 18);
        stray.mint(address(vault), 5e18);
        vm.deal(address(vault), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, user));
        vm.prank(user);
        vault.sweep(address(stray), user, 5e18);
        vm.startPrank(safe);
        vault.sweep(address(stray), keeper, 5e18);
        vault.sweepETH(keeper, 1 ether);
        vm.stopPrank();
        assertEq(stray.balanceOf(keeper), 5e18);
        assertEq(keeper.balance, 1 ether);
    }
}
