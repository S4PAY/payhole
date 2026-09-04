// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BurnVault} from "../../src/BurnVault.sol";
import {ChainConfig} from "../utils/ChainConfig.sol";

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);

    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}

interface IV4Quoter {
    struct QuoteExactSingleParams {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    function quoteExactInputSingle(QuoteExactSingleParams memory params)
        external
        returns (uint256 amountOut, uint256 gasEstimate);
}

/// @notice BurnVault against real Pons pools on a Robinhood Chain fork pinned to a block where they had
///         liquidity: a v15 launch trading in a Uniswap V3 WETH pool (PUSH), and two V2 graduations trading
///         in Uniswap V4 pools with the live Pons meme hook (TAMC paired with ETH, Robby paired with USDG).
/// @dev Needs an archive fork source (scripts/fork-test.sh uses ARCHIVE_RPC_URL_4663 when set).
contract BurnVaultPonsForkTest is Test {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant PINNED_BLOCK = 54_015_994;

    // Pons v15 launch (Uniswap V3 token/WETH pool, fee 10000)
    address internal constant PUSH = 0x619D1C43FcAF0C90cFdeCfcbc9eb4A54988778AB;
    // Pons V2 graduations (Uniswap V4 pools, fee 0, tickSpacing 200, meme hook)
    address internal constant TAMC = 0xd006A2953572F68B77C2c36aD9a80eA0593436c0;
    address internal constant ROBBY = 0xCeAA8032151062225cfEcF8546b1b0492e738578;
    address internal constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;

    ChainConfig.Addresses internal a;
    address internal safe = makeAddr("safe");
    address internal user = makeAddr("user");

    function setUp() public {
        string memory rpc = vm.envOr("FORK_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc, PINNED_BLOCK);
        assertEq(block.chainid, 4663, "not Robinhood Chain");
        a = ChainConfig.load(vm);
        deal(a.usdg, user, 1000e6);
        vm.deal(user, 10 ether);
    }

    function _vault(address token) internal returns (BurnVault vault) {
        vault = new BurnVault(a.poolManager, a.swapRouter02, a.usdg, a.weth, safe);
        vm.prank(safe);
        vault.setToken(token);
        vm.prank(user);
        IERC20(a.usdg).approve(address(vault), type(uint256).max);
    }

    function _assertEmpty(BurnVault vault, address token) internal view {
        assertEq(IERC20(a.usdg).balanceOf(address(vault)), 0, "usdg left");
        assertEq(IERC20(a.weth).balanceOf(address(vault)), 0, "weth left");
        assertEq(IERC20(token).balanceOf(address(vault)), 0, "token left");
        assertEq(address(vault).balance, 0, "eth left");
    }

    function test_v3_ethIntoPonsV15Token() public {
        BurnVault vault = _vault(PUSH);
        vm.prank(safe);
        vault.setRouteV3(address(0), abi.encodePacked(a.weth, uint24(10_000), PUSH));
        (uint256 quote,,,) = IQuoterV2(a.quoterV2)
            .quoteExactInputSingle(IQuoterV2.QuoteExactInputSingleParams(a.weth, PUSH, 0.001 ether, 10_000, 0));
        assertGt(quote, 0);
        uint256 deadBefore = IERC20(PUSH).balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith{value: 0.001 ether}(address(0), 0.001 ether, quote, block.timestamp + 60);
        assertEq(burned, quote);
        assertEq(IERC20(PUSH).balanceOf(DEAD) - deadBefore, burned);
        _assertEmpty(vault, PUSH);
    }

    function test_v3_usdgIntoPonsV15TokenTwoHops() public {
        BurnVault vault = _vault(PUSH);
        bytes memory path = abi.encodePacked(a.usdg, uint24(100), a.weth, uint24(10_000), PUSH);
        vm.prank(safe);
        vault.setRouteV3(a.usdg, path);
        (uint256 quote,,,) = IQuoterV2(a.quoterV2).quoteExactInput(path, 1e6);
        assertGt(quote, 0);
        uint256 deadBefore = IERC20(PUSH).balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith(a.usdg, 1e6, quote, block.timestamp + 60);
        assertEq(burned, quote);
        assertEq(IERC20(PUSH).balanceOf(DEAD) - deadBefore, burned);
        assertEq(IERC20(a.usdg).balanceOf(user), 999e6);
        _assertEmpty(vault, PUSH);
    }

    function test_v3_slippageRevertsThroughRouter() public {
        BurnVault vault = _vault(PUSH);
        vm.prank(safe);
        vault.setRouteV3(address(0), abi.encodePacked(a.weth, uint24(10_000), PUSH));
        (uint256 quote,,,) = IQuoterV2(a.quoterV2)
            .quoteExactInputSingle(IQuoterV2.QuoteExactInputSingleParams(a.weth, PUSH, 0.001 ether, 10_000, 0));
        vm.expectRevert(bytes("Too little received"));
        vm.prank(user);
        vault.burnWith{value: 0.001 ether}(address(0), 0.001 ether, quote + 1, block.timestamp + 60);
    }

    function test_v4_ethIntoGraduatedTokenThroughPonsHook() public {
        BurnVault vault = _vault(TAMC);
        PoolKey memory key = PoolKey(Currency.wrap(address(0)), Currency.wrap(TAMC), 0, 200, IHooks(PONS_HOOK));
        PoolKey[] memory hops = new PoolKey[](1);
        hops[0] = key;
        vm.prank(safe);
        vault.setRoute(address(0), hops);
        assertFalse(vault.ethRouteUsesWeth());
        (uint256 quote,) =
            IV4Quoter(a.v4Quoter).quoteExactInputSingle(IV4Quoter.QuoteExactSingleParams(key, true, 0.001 ether, ""));
        assertGt(quote, 0);
        uint256 deadBefore = IERC20(TAMC).balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith{value: 0.001 ether}(address(0), 0.001 ether, quote, block.timestamp + 60);
        assertEq(burned, quote);
        assertEq(IERC20(TAMC).balanceOf(DEAD) - deadBefore, burned);
        _assertEmpty(vault, TAMC);
    }

    function test_v4_usdgIntoGraduatedTokenThroughPonsHook() public {
        BurnVault vault = _vault(ROBBY);
        PoolKey memory key = PoolKey(Currency.wrap(a.usdg), Currency.wrap(ROBBY), 0, 200, IHooks(PONS_HOOK));
        PoolKey[] memory hops = new PoolKey[](1);
        hops[0] = key;
        vm.prank(safe);
        vault.setRoute(a.usdg, hops);
        (uint256 quote,) =
            IV4Quoter(a.v4Quoter).quoteExactInputSingle(IV4Quoter.QuoteExactSingleParams(key, true, 1e6, ""));
        assertGt(quote, 0);
        uint256 deadBefore = IERC20(ROBBY).balanceOf(DEAD);
        vm.prank(user);
        uint256 burned = vault.burnWith(a.usdg, 1e6, quote, block.timestamp + 60);
        assertEq(burned, quote);
        assertEq(IERC20(ROBBY).balanceOf(DEAD) - deadBefore, burned);
        _assertEmpty(vault, ROBBY);
    }
}
