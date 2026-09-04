// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {OwnerSweep} from "./base/OwnerSweep.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IWETH9} from "./interfaces/IWETH9.sol";

/// @title BurnVault
/// @notice Turns USDG and ETH into $PayHole through Uniswap and sends every unit to the burn address.
/// @dev The token never pays anyone; this contract only buys and burns. Anyone can call {burnWith} with
///      their own funds. Assets transferred to the vault directly can be converted by the owner through
///      {burnHeld}. The owner (the protocol Safe) sets the token address once, configures one swap route
///      per input after the launchpad creates the pool, prices unlock tiers, and can sweep stuck assets.
///      A route is either Uniswap V4 (one or two pool keys, swapped inside the PoolManager's unlock
///      callback with output taken straight to the burn address) or Uniswap V3 (a packed path swapped
///      through SwapRouter02 with the burn address as recipient). ETH is paid into V4 as native currency
///      unless the V4 route starts in a WETH pool; V3 routes always wrap ETH first.
contract BurnVault is OwnerSweep, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;

    enum RouteKind {
        None,
        V4,
        V3
    }

    struct CallbackData {
        address routeKey;
        Currency currencyIn;
        uint256 amountIn;
        uint256 minAmountOut;
    }

    /// @notice Destination of every burned token.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    /// @notice Uniswap V4 singleton used by V4 routes.
    IPoolManager public immutable poolManager;
    /// @notice Uniswap V3 SwapRouter02 used by V3 routes.
    ISwapRouter02 public immutable swapRouter;
    /// @notice Settlement asset accepted alongside native ETH.
    IERC20 public immutable usdg;
    /// @notice Wrapped ETH, used by V3 routes and by V4 routes that start in a WETH pool.
    IWETH9 public immutable weth;

    /// @notice The $PayHole token. Zero until the owner sets it once after launch.
    address public token;
    /// @notice Which kind of route is configured for each input (USDG address or zero for ETH).
    mapping(address tokenIn => RouteKind kind) public routeKind;
    /// @notice True when the configured ETH route needs incoming ETH wrapped to WETH before swapping.
    bool public ethRouteUsesWeth;
    /// @notice $PayHole burned by {unlock} for each tier. Zero means the tier is not offered.
    mapping(uint8 tier => uint256 cost) public tierCost;
    /// @notice Highest tier each address has unlocked.
    mapping(address user => uint8 tier) public tierOf;

    mapping(address tokenIn => PoolKey[] hops) private _v4Routes;
    mapping(address tokenIn => bytes path) private _v3Paths;

    event TokenSet(address indexed token);
    event RouteSet(address indexed tokenIn, uint256 hops, bool viaWeth);
    event RouteSetV3(address indexed tokenIn, bytes path);
    event TierCostSet(uint8 indexed tier, uint256 cost);
    event Burned(address indexed from, address indexed tokenIn, uint256 amountIn, uint256 tokensBurned);
    event Unlocked(address indexed user, uint8 tier);

    error NotPoolManager();
    error Expired();
    error ZeroAmount();
    error ValueMismatch();
    error TokenAlreadySet();
    error TokenNotSet();
    error UnsupportedToken(address tokenIn);
    error RouteNotSet();
    error BadRoute();
    error InvalidTier();
    error TierNotConfigured(uint8 tier);
    error TierNotHigher(uint8 current);
    error PartialFill(uint256 hop, int256 consumed, uint256 expected);
    error NoOutput(uint256 hop);
    error InsufficientOutput(uint256 received, uint256 minimum);
    error SettleMismatch(uint256 paid, uint256 expected);

    /// @param poolManager_ Uniswap V4 PoolManager on this chain.
    /// @param swapRouter_ Uniswap V3 SwapRouter02 on this chain.
    /// @param usdg_ USDG token.
    /// @param weth_ Wrapped ETH on this chain.
    /// @param initialOwner Owner of the vault (the protocol Safe).
    constructor(address poolManager_, address swapRouter_, address usdg_, address weth_, address initialOwner)
        Ownable(initialOwner)
    {
        if (poolManager_ == address(0) || swapRouter_ == address(0) || usdg_ == address(0) || weth_ == address(0)) {
            revert ZeroAddress();
        }
        poolManager = IPoolManager(poolManager_);
        swapRouter = ISwapRouter02(swapRouter_);
        usdg = IERC20(usdg_);
        weth = IWETH9(weth_);
    }

    /// @notice Accept ETH sent directly. The owner converts it with {burnHeld}.
    receive() external payable {}

    // ------------------------------------------------------------ owner configuration

    /// @notice Set the $PayHole token address. Can only happen once.
    /// @param token_ Address of the token created by the launchpad.
    function setToken(address token_) external onlyOwner {
        if (token != address(0)) revert TokenAlreadySet();
        if (token_ == address(0)) revert ZeroAddress();
        token = token_;
        emit TokenSet(token_);
    }

    /// @notice Configure a Uniswap V4 route from `tokenIn` (USDG, or the zero address for ETH) to $PayHole.
    /// @dev One or two pool keys, each sharing a currency with the previous hop, ending at the token.
    ///      An ETH route may start in a native-currency pool or in a WETH pool; the vault wraps incoming
    ///      ETH when it starts in WETH. Replaces any previous route of either kind for that input.
    /// @param tokenIn USDG address or zero for ETH.
    /// @param hops Pool keys in swap order, exactly as the pools were initialized (fee, spacing, hooks).
    function setRoute(address tokenIn, PoolKey[] calldata hops) external onlyOwner {
        address token_ = token;
        if (token_ == address(0)) revert TokenNotSet();
        _requireSupported(tokenIn);
        if (hops.length == 0 || hops.length > 2) revert BadRoute();
        Currency cur = Currency.wrap(tokenIn);
        bool viaWeth = false;
        if (tokenIn == address(0) && !_contains(hops[0], cur)) {
            cur = Currency.wrap(address(weth));
            viaWeth = true;
        }
        for (uint256 i = 0; i < hops.length; ++i) {
            if (cur == hops[i].currency0) cur = hops[i].currency1;
            else if (cur == hops[i].currency1) cur = hops[i].currency0;
            else revert BadRoute();
        }
        if (Currency.unwrap(cur) != token_) revert BadRoute();
        delete _v4Routes[tokenIn];
        delete _v3Paths[tokenIn];
        for (uint256 i = 0; i < hops.length; ++i) {
            _v4Routes[tokenIn].push(hops[i]);
        }
        routeKind[tokenIn] = RouteKind.V4;
        if (tokenIn == address(0)) ethRouteUsesWeth = viaWeth;
        emit RouteSet(tokenIn, hops.length, viaWeth);
    }

    /// @notice Configure a Uniswap V3 route from `tokenIn` (USDG, or the zero address for ETH) to $PayHole.
    /// @dev `path` is the packed SwapRouter02 path `tokenA | fee | tokenB | fee | ... | token`, one to
    ///      three hops. It must start at USDG for the USDG route or at WETH for the ETH route (the vault
    ///      wraps ETH first) and end at the token. Replaces any previous route of either kind for that input.
    /// @param tokenIn USDG address or zero for ETH.
    /// @param path Packed path as SwapRouter02 expects it.
    function setRouteV3(address tokenIn, bytes calldata path) external onlyOwner {
        address token_ = token;
        if (token_ == address(0)) revert TokenNotSet();
        _requireSupported(tokenIn);
        if (path.length < 43 || path.length > 89 || (path.length - 20) % 23 != 0) revert BadRoute();
        address start = tokenIn == address(0) ? address(weth) : tokenIn;
        if (address(bytes20(path[0:20])) != start) revert BadRoute();
        if (address(bytes20(path[path.length - 20:])) != token_) revert BadRoute();
        delete _v4Routes[tokenIn];
        _v3Paths[tokenIn] = path;
        routeKind[tokenIn] = RouteKind.V3;
        if (tokenIn == address(0)) ethRouteUsesWeth = true;
        emit RouteSetV3(tokenIn, path);
    }

    /// @notice Price an unlock tier in $PayHole. Zero removes the tier.
    /// @param tier Tier number, 1 or higher.
    /// @param cost Amount of $PayHole burned to unlock it.
    function setTierCost(uint8 tier, uint256 cost) external onlyOwner {
        if (tier == 0) revert InvalidTier();
        tierCost[tier] = cost;
        emit TierCostSet(tier, cost);
    }

    // ------------------------------------------------------------- burn entry points

    /// @notice Swap the caller's USDG or ETH into $PayHole and burn all of it in one call.
    /// @dev For USDG the caller must have approved the vault and `msg.value` must be zero. For ETH pass
    ///      the zero address and send exactly `amount` as `msg.value`.
    /// @param tokenIn USDG address or zero for ETH.
    /// @param amount Input amount in base units.
    /// @param minAmountOut Minimum $PayHole to burn; quote off-chain and subtract a tolerance.
    /// @param deadline Last unix second at which the transaction may execute.
    /// @return tokensBurned $PayHole delivered to the burn address.
    function burnWith(address tokenIn, uint256 amount, uint256 minAmountOut, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 tokensBurned)
    {
        if (block.timestamp > deadline) revert Expired();
        if (amount == 0) revert ZeroAmount();
        if (tokenIn == address(0)) {
            if (msg.value != amount) revert ValueMismatch();
        } else if (tokenIn == address(usdg)) {
            if (msg.value != 0) revert ValueMismatch();
            usdg.safeTransferFrom(msg.sender, address(this), amount);
        } else {
            revert UnsupportedToken(tokenIn);
        }
        tokensBurned = _swapAndBurn(tokenIn, amount, minAmountOut);
    }

    /// @notice Convert everything the vault holds of `tokenIn` and burn it. Owner only.
    /// @dev Recovers assets transferred straight to the vault. Held $PayHole is forwarded to the burn
    ///      address without a swap.
    /// @param tokenIn USDG address, zero for ETH, or the $PayHole token.
    /// @param minAmountOut Minimum $PayHole to burn when a swap is involved.
    /// @param deadline Last unix second at which the transaction may execute.
    /// @return tokensBurned $PayHole delivered to the burn address.
    function burnHeld(address tokenIn, uint256 minAmountOut, uint256 deadline)
        external
        onlyOwner
        nonReentrant
        returns (uint256 tokensBurned)
    {
        if (block.timestamp > deadline) revert Expired();
        address token_ = token;
        if (token_ != address(0) && tokenIn == token_) {
            uint256 held = IERC20(token_).balanceOf(address(this));
            _requireNonZero(held);
            IERC20(token_).safeTransfer(BURN_ADDRESS, held);
            emit Burned(msg.sender, token_, held, held);
            return held;
        }
        uint256 amount = _heldBalance(tokenIn);
        _requireNonZero(amount);
        tokensBurned = _swapAndBurn(tokenIn, amount, minAmountOut);
    }

    /// @notice Burn `amount` of the caller's $PayHole directly.
    /// @param amount Token base units; the caller must have approved the vault.
    function burnDirect(uint256 amount) external nonReentrant {
        address token_ = token;
        if (token_ == address(0)) revert TokenNotSet();
        if (amount == 0) revert ZeroAmount();
        IERC20(token_).safeTransferFrom(msg.sender, BURN_ADDRESS, amount);
        emit Burned(msg.sender, token_, amount, amount);
    }

    /// @notice Burn the configured amount of $PayHole to record `tier` for the caller.
    /// @dev Only upgrades are accepted, and each tier costs its full price.
    /// @param tier Tier to unlock; must be configured and higher than the caller's current tier.
    function unlock(uint8 tier) external nonReentrant {
        address token_ = token;
        if (token_ == address(0)) revert TokenNotSet();
        uint256 cost = tierCost[tier];
        if (cost == 0) revert TierNotConfigured(tier);
        uint8 current = tierOf[msg.sender];
        if (tier <= current) revert TierNotHigher(current);
        tierOf[msg.sender] = tier;
        IERC20(token_).safeTransferFrom(msg.sender, BURN_ADDRESS, cost);
        emit Burned(msg.sender, token_, cost, cost);
        emit Unlocked(msg.sender, tier);
    }

    // ------------------------------------------------------------------------ views

    /// @notice Configured Uniswap V4 pool keys for `tokenIn` (USDG or zero for ETH); empty for V3 routes.
    function route(address tokenIn) external view returns (PoolKey[] memory) {
        _requireSupported(tokenIn);
        return _v4Routes[tokenIn];
    }

    /// @notice Configured Uniswap V3 packed path for `tokenIn` (USDG or zero for ETH); empty for V4 routes.
    function routeV3(address tokenIn) external view returns (bytes memory) {
        _requireSupported(tokenIn);
        return _v3Paths[tokenIn];
    }

    // ------------------------------------------------------------- Uniswap V4 callback

    /// @notice Entered only by the PoolManager during a V4 {burnWith} or {burnHeld}.
    /// @dev Swaps hop by hop with exact input, checks slippage, pays the input currency, and takes the
    ///      output directly to the burn address. A two-hop route nets the middle currency to zero.
    /// @param rawData ABI-encoded {CallbackData}.
    /// @return ABI-encoded amount of $PayHole taken to the burn address.
    function unlockCallback(bytes calldata rawData) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        CallbackData memory d = abi.decode(rawData, (CallbackData));
        PoolKey[] storage hops = _v4Routes[d.routeKey];
        uint256 n = hops.length;
        if (n == 0) revert RouteNotSet();

        Currency cur = d.currencyIn;
        uint256 amount = d.amountIn;
        for (uint256 i = 0; i < n; ++i) {
            (cur, amount) = _swapHop(hops[i], cur, amount, i);
        }
        if (amount < d.minAmountOut) revert InsufficientOutput(amount, d.minAmountOut);

        poolManager.sync(d.currencyIn);
        uint256 paid;
        if (d.currencyIn.isAddressZero()) {
            paid = poolManager.settle{value: d.amountIn}();
        } else {
            IERC20(Currency.unwrap(d.currencyIn)).safeTransfer(address(poolManager), d.amountIn);
            paid = poolManager.settle();
        }
        if (paid != d.amountIn) revert SettleMismatch(paid, d.amountIn);

        poolManager.take(cur, BURN_ADDRESS, amount);
        return abi.encode(amount);
    }

    // --------------------------------------------------------------------- internals

    /// @dev Exact-input swap of `amountIn` of `currencyIn` through `key`. Returns the other currency and
    ///      the amount received, both read from the PoolManager's balance delta.
    function _swapHop(PoolKey memory key, Currency currencyIn, uint256 amountIn, uint256 hop)
        private
        returns (Currency currencyOut, uint256 amountOut)
    {
        bool zeroForOne = currencyIn == key.currency0;
        BalanceDelta delta = poolManager.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -SafeCast.toInt256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int256 consumed = -int256(zeroForOne ? delta.amount0() : delta.amount1());
        int256 received = int256(zeroForOne ? delta.amount1() : delta.amount0());
        if (consumed != SafeCast.toInt256(amountIn)) revert PartialFill(hop, consumed, amountIn);
        if (received <= 0) revert NoOutput(hop);
        currencyOut = zeroForOne ? key.currency1 : key.currency0;
        amountOut = SafeCast.toUint256(received);
    }

    /// @dev Wraps ETH when the route needs WETH, then swaps through V4 (unlock) or V3 (SwapRouter02).
    function _swapAndBurn(address tokenIn, uint256 amountIn, uint256 minAmountOut)
        private
        returns (uint256 tokensBurned)
    {
        if (token == address(0)) revert TokenNotSet();
        RouteKind kind = routeKind[tokenIn];
        if (kind == RouteKind.None) revert RouteNotSet();
        address asset = tokenIn;
        if (tokenIn == address(0) && ethRouteUsesWeth) {
            weth.deposit{value: amountIn}();
            asset = address(weth);
        }
        if (kind == RouteKind.V4) {
            bytes memory result = poolManager.unlock(
                abi.encode(
                    CallbackData({
                        routeKey: tokenIn,
                        currencyIn: Currency.wrap(asset),
                        amountIn: amountIn,
                        minAmountOut: minAmountOut
                    })
                )
            );
            tokensBurned = abi.decode(result, (uint256));
        } else {
            IERC20(asset).forceApprove(address(swapRouter), amountIn);
            tokensBurned = swapRouter.exactInput(
                ISwapRouter02.ExactInputParams({
                    path: _v3Paths[tokenIn], recipient: BURN_ADDRESS, amountIn: amountIn, amountOutMinimum: minAmountOut
                })
            );
        }
        emit Burned(msg.sender, tokenIn, amountIn, tokensBurned);
    }

    function _heldBalance(address tokenIn) private view returns (uint256) {
        if (tokenIn == address(0)) return address(this).balance;
        if (tokenIn == address(usdg)) return usdg.balanceOf(address(this));
        revert UnsupportedToken(tokenIn);
    }

    function _contains(PoolKey calldata key, Currency currency) private pure returns (bool) {
        return key.currency0 == currency || key.currency1 == currency;
    }

    function _requireSupported(address tokenIn) private view {
        if (tokenIn != address(0) && tokenIn != address(usdg)) revert UnsupportedToken(tokenIn);
    }

    function _requireNonZero(uint256 amount) private pure {
        // A zero guard on a held balance is safe: a donation can only let the burn proceed.
        // slither-disable-next-line incorrect-equality
        if (amount == 0) revert ZeroAmount();
    }
}
