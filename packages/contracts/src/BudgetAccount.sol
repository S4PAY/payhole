// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/// @title BudgetAccount
/// @notice A spending pocket that holds a USDG budget for a single owner.
/// @dev Deployed as an EIP-1167 minimal proxy by {BudgetAccountFactory}; `initialize` runs once and
///      only from the factory. The owner deposits USDG, pushes funds to per-site addresses under a
///      per-site cap, and issues session keys that may pay from the account under a per-key cap, an
///      expiry, and a global cap shared by every key. No other path moves funds out, and the protocol
///      has no privileged access to any account.
contract BudgetAccount {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    /// @notice Spending permission granted to one session key address.
    /// @param cap Lifetime spend allowed for the key, in USDG base units.
    /// @param spent Amount the key has already spent.
    /// @param expiry Last unix second at which the key may pay.
    /// @param epoch Revoke-all generation the key was issued in. Keys from older generations are dead.
    struct SessionKey {
        uint96 cap;
        uint96 spent;
        uint40 expiry;
        uint24 epoch;
    }

    /// @notice Funding limit for one per-site address.
    /// @param cap Lifetime USDG the owner may push to the address.
    /// @param funded USDG already pushed.
    struct Site {
        uint128 cap;
        uint128 funded;
    }

    /// @notice Settlement asset shared by every account created by the factory.
    IERC20 public immutable usdg;
    /// @notice The only address allowed to initialize proxies of this implementation.
    address public immutable factory;

    /// @notice Account owner: the only address that can withdraw, sweep, or configure the account.
    address public owner;
    /// @notice Current session key generation. {revokeAll} increments it.
    uint24 public epoch;
    /// @notice Maximum total USDG all session keys together may spend.
    uint96 public globalCap;
    /// @notice USDG spent through session keys so far.
    uint96 public globalSpent;

    mapping(address key => SessionKey) private _keys;
    mapping(address addr => Site) private _sites;

    event Initialized(address indexed owner);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event GlobalCapSet(uint256 cap);
    event SessionKeySet(address indexed key, uint256 cap, uint256 expiry, uint256 epoch);
    event SessionKeyRevoked(address indexed key);
    event AllSessionKeysRevoked(uint256 epoch);
    event Paid(address indexed key, address indexed to, uint256 amount);
    event SiteCapSet(address indexed site, uint256 cap);
    event SiteFunded(address indexed site, uint256 amount);
    event Swept(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotFactory();
    error AlreadyInitialized();
    error ZeroAddress();
    error ZeroAmount();
    error InvalidExpiry();
    error InvalidSessionKey();
    error KeyCapExceeded(uint256 remaining);
    error GlobalCapExceeded(uint256 remaining);
    error SiteCapExceeded(uint256 remaining);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param usdg_ Address of the USDG token used by all accounts.
    constructor(address usdg_) {
        if (usdg_ == address(0)) revert ZeroAddress();
        usdg = IERC20(usdg_);
        factory = msg.sender;
    }

    /// @notice Accept ETH so stray transfers can be recovered by the owner.
    receive() external payable {}

    /// @notice Set the owner of a freshly cloned account. Runs once, from the factory only.
    /// @param owner_ Address that will control the account.
    function initialize(address owner_) external {
        if (msg.sender != factory) revert NotFactory();
        if (owner != address(0)) revert AlreadyInitialized();
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit Initialized(owner_);
    }

    // ------------------------------------------------------------------ budget

    /// @notice Pull `amount` USDG from the caller into the account. Anyone may top up an account.
    /// @param amount USDG base units; the caller must have approved the account.
    function deposit(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        usdg.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Send `amount` USDG from the account to `to`.
    /// @param to Recipient.
    /// @param amount USDG base units.
    function withdraw(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        usdg.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }

    /// @notice Recover any ERC-20 held by the account, including USDG.
    /// @param token Token to move.
    /// @param to Recipient.
    /// @param amount Token base units.
    function sweep(address token, address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        IERC20(token).safeTransfer(to, amount);
        emit Swept(token, to, amount);
    }

    /// @notice Recover ETH held by the account.
    /// @param to Recipient.
    /// @param amount Wei.
    function sweepETH(address to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        Address.sendValue(payable(to), amount);
        emit Swept(address(0), to, amount);
    }

    // ------------------------------------------------------------ session keys

    /// @notice Set the maximum total spend shared by all session keys.
    /// @dev Lowering the cap below `globalSpent` stops every key until the cap is raised again.
    /// @param cap USDG base units.
    function setGlobalCap(uint256 cap) external onlyOwner {
        globalCap = cap.toUint96();
        emit GlobalCapSet(cap);
    }

    /// @notice Create or update a session key with its own cap and expiry.
    /// @dev Updating a key that is live in the current epoch keeps what it has already spent.
    /// @param key Address that will call {pay}.
    /// @param cap Lifetime spend allowed for the key, USDG base units. Must be non-zero.
    /// @param expiry Unix timestamp after which the key can no longer pay. Must be in the future.
    function setSessionKey(address key, uint256 cap, uint256 expiry) external onlyOwner {
        if (key == address(0)) revert ZeroAddress();
        if (cap == 0) revert ZeroAmount();
        if (expiry <= block.timestamp) revert InvalidExpiry();
        SessionKey storage k = _keys[key];
        uint96 spent = (k.cap != 0 && k.epoch == epoch) ? k.spent : 0;
        _keys[key] = SessionKey({cap: cap.toUint96(), spent: spent, expiry: expiry.toUint40(), epoch: epoch});
        emit SessionKeySet(key, cap, expiry, epoch);
    }

    /// @notice Revoke one session key. Its next call fails.
    /// @param key Address to revoke.
    function revokeSessionKey(address key) external onlyOwner {
        delete _keys[key];
        emit SessionKeyRevoked(key);
    }

    /// @notice Revoke every session key in one transaction by starting a new epoch.
    /// @dev Global spend accounting is untouched; adjust it with {setGlobalCap} if needed.
    function revokeAll() external onlyOwner {
        epoch += 1;
        emit AllSessionKeysRevoked(epoch);
    }

    /// @notice Pay `amount` USDG to `to` as a session key, within the key's cap and the global cap.
    /// @dev The caller is the session key. It may pay itself to obtain USDG it can then authorize
    ///      over EIP-3009 for x402 settlement.
    /// @param to Recipient.
    /// @param amount USDG base units.
    function pay(address to, uint256 amount) external {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        SessionKey storage k = _keys[msg.sender];
        if (!_isLive(k)) revert InvalidSessionKey();
        uint96 amt = amount.toUint96();
        uint96 keyRemaining = _sub0(k.cap, k.spent);
        if (amt > keyRemaining) revert KeyCapExceeded(keyRemaining);
        uint96 globalRemaining = _sub0(globalCap, globalSpent);
        if (amt > globalRemaining) revert GlobalCapExceeded(globalRemaining);
        k.spent += amt;
        globalSpent += amt;
        usdg.safeTransfer(to, amount);
        emit Paid(msg.sender, to, amount);
    }

    // ------------------------------------------------------- per-site addresses

    /// @notice Set the lifetime funding cap for a per-site address.
    /// @dev A cap below the amount already funded blocks further funding without reverting anything.
    /// @param site Per-site address.
    /// @param cap USDG base units.
    function setSiteCap(address site, uint256 cap) external onlyOwner {
        if (site == address(0)) revert ZeroAddress();
        _sites[site].cap = cap.toUint128();
        emit SiteCapSet(site, cap);
    }

    /// @notice Push `amount` USDG to a per-site address, enforcing its cap on-chain.
    /// @param site Per-site address.
    /// @param amount USDG base units.
    function fund(address site, uint256 amount) external onlyOwner {
        if (site == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        Site storage s = _sites[site];
        uint128 remaining = s.cap > s.funded ? s.cap - s.funded : 0;
        if (amount > remaining) revert SiteCapExceeded(remaining);
        s.funded += amount.toUint128();
        usdg.safeTransfer(site, amount);
        emit SiteFunded(site, amount);
    }

    // ------------------------------------------------------------------- views

    /// @notice Stored permission for `key`, whether or not it is still live.
    function sessionKey(address key) external view returns (SessionKey memory) {
        return _keys[key];
    }

    /// @notice True when `key` exists, belongs to the current epoch, and has not expired.
    function isSessionKeyLive(address key) external view returns (bool) {
        return _isLive(_keys[key]);
    }

    /// @notice USDG `key` can still spend right now: the smaller of its own and the global headroom.
    function remainingForKey(address key) external view returns (uint256) {
        SessionKey storage k = _keys[key];
        if (!_isLive(k)) return 0;
        uint96 keyRemaining = _sub0(k.cap, k.spent);
        uint96 globalRemaining = _sub0(globalCap, globalSpent);
        return keyRemaining < globalRemaining ? keyRemaining : globalRemaining;
    }

    /// @notice Funding cap and amount funded for a per-site address.
    function siteInfo(address site_) external view returns (Site memory) {
        return _sites[site_];
    }

    /// @notice USDG that can still be pushed to `site_`.
    function siteRemaining(address site_) external view returns (uint256) {
        Site storage s = _sites[site_];
        return s.cap > s.funded ? s.cap - s.funded : 0;
    }

    function _isLive(SessionKey storage k) private view returns (bool) {
        return k.cap != 0 && k.epoch == epoch && block.timestamp <= k.expiry;
    }

    function _sub0(uint96 a, uint96 b) private pure returns (uint96) {
        return a > b ? a - b : 0;
    }
}
