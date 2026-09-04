// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Compiled under the `v4` profile (solc 0.8.26) because Uniswap's PoolManager.sol pins that version.
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {BurnVault} from "../../src/BurnVault.sol";
import {BurnVaultSuite} from "../utils/BurnVaultSuite.sol";
import {MockUSDG} from "../mocks/MockUSDG.sol";
import {MockWETH9} from "../mocks/MockWETH9.sol";
import {MockSwapRouter02} from "../mocks/MockSwapRouter02.sol";

contract BurnVaultLocalTest is BurnVaultSuite {
    MockSwapRouter02 internal mockRouter;

    function setUp() public {
        mockRouter = new MockSwapRouter02();
        _setUp(
            IPoolManager(address(new PoolManager(address(this)))),
            address(new MockUSDG()),
            address(new MockWETH9()),
            address(mockRouter)
        );
    }

    function _v3Path(address a, uint24 fee, address b) internal pure returns (bytes memory) {
        return abi.encodePacked(a, fee, b);
    }

    // -------------------------------------------------- V3 route plumbing (mock router)

    function test_setRouteV3_validation() public {
        bytes memory good = _v3Path(address(usdg), 3000, address(payhole));
        vm.startPrank(safe);
        vm.expectRevert(BurnVault.TokenNotSet.selector);
        vault.setRouteV3(address(usdg), good);
        vault.setToken(address(payhole));
        // must start at USDG for the USDG route
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRouteV3(address(usdg), _v3Path(address(weth), 3000, address(payhole)));
        // must end at the token
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRouteV3(address(usdg), _v3Path(address(usdg), 3000, address(weth)));
        // malformed lengths
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRouteV3(address(usdg), abi.encodePacked(address(usdg), address(payhole)));
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRouteV3(address(usdg), abi.encodePacked(good, uint8(1)));
        // more than three hops
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRouteV3(
            address(usdg),
            abi.encodePacked(
                address(usdg),
                uint24(1),
                address(weth),
                uint24(1),
                address(usdg),
                uint24(1),
                address(weth),
                uint24(1),
                address(payhole)
            )
        );
        vm.expectRevert(abi.encodeWithSelector(BurnVault.UnsupportedToken.selector, address(payhole)));
        vault.setRouteV3(address(payhole), good);
        vm.expectEmit(address(vault));
        emit BurnVault.RouteSetV3(address(usdg), good);
        vault.setRouteV3(address(usdg), good);
        assertEq(uint8(vault.routeKind(address(usdg))), uint8(BurnVault.RouteKind.V3));
        assertEq(vault.routeV3(address(usdg)), good);
        assertEq(vault.route(address(usdg)).length, 0);
        // switching back to V4 clears the V3 path
        vault.setRoute(address(usdg), _route(usdgPool));
        assertEq(uint8(vault.routeKind(address(usdg))), uint8(BurnVault.RouteKind.V4));
        assertEq(vault.routeV3(address(usdg)).length, 0);
        assertEq(vault.route(address(usdg)).length, 1);
        vm.stopPrank();
    }

    function test_setRouteV3_ethAlwaysWraps() public {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vm.expectRevert(BurnVault.BadRoute.selector);
        vault.setRouteV3(address(0), _v3Path(address(0), 3000, address(payhole)));
        vault.setRouteV3(address(0), _v3Path(address(weth), 3000, address(payhole)));
        assertTrue(vault.ethRouteUsesWeth());
        vault.setRoute(address(0), _route(ethPool));
        assertFalse(vault.ethRouteUsesWeth());
        assertEq(vault.routeV3(address(0)).length, 0);
        vm.stopPrank();
    }

    function test_burnWith_usdgViaV3() public {
        bytes memory path = _v3Path(address(usdg), 3000, address(payhole));
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRouteV3(address(usdg), path);
        vm.stopPrank();
        uint256 deadBefore = payhole.balanceOf(DEAD);
        vm.expectEmit(address(vault));
        emit BurnVault.Burned(user, address(usdg), 100e6, 100e6 * 1000);
        vm.prank(user);
        uint256 burned = vault.burnWith(address(usdg), 100e6, 0, _deadline());
        assertEq(burned, 100e6 * 1000);
        assertEq(payhole.balanceOf(DEAD) - deadBefore, burned);
        assertEq(usdg.balanceOf(address(mockRouter)), 100e6);
        assertEq(mockRouter.lastPath(), path);
        assertEq(usdg.allowance(address(vault), address(mockRouter)), 0);
        _assertVaultEmpty();
    }

    function test_burnWith_ethViaV3WrapsFirst() public {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRouteV3(address(0), _v3Path(address(weth), 10_000, address(payhole)));
        vm.stopPrank();
        uint256 wethSupplyBefore = weth.totalSupply();
        vm.prank(user);
        uint256 burned = vault.burnWith{value: 1 ether}(address(0), 1 ether, 0, _deadline());
        assertEq(burned, 1 ether * 1000);
        assertEq(weth.totalSupply(), wethSupplyBefore + 1 ether);
        assertEq(weth.balanceOf(address(mockRouter)), 1 ether);
        _assertVaultEmpty();
    }

    function test_burnWith_v3SlippageEnforcedByRouter() public {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRouteV3(address(usdg), _v3Path(address(usdg), 3000, address(payhole)));
        vm.stopPrank();
        vm.expectRevert(bytes("Too little received"));
        vm.prank(user);
        vault.burnWith(address(usdg), 1e6, 1e6 * 1000 + 1, _deadline());
    }

    function test_burnHeld_ethViaV3() public {
        vm.startPrank(safe);
        vault.setToken(address(payhole));
        vault.setRouteV3(address(0), _v3Path(address(weth), 10_000, address(payhole)));
        vm.stopPrank();
        vm.prank(user);
        (bool ok,) = address(vault).call{value: 2 ether}("");
        assertTrue(ok);
        vm.prank(safe);
        assertEq(vault.burnHeld(address(0), 0, _deadline()), 2 ether * 1000);
        _assertVaultEmpty();
    }
}
