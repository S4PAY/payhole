// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {OwnerSweep} from "./base/OwnerSweep.sol";

/// @title CreatorRegistry
/// @notice Maps domains to creator wallets and routes USDG tips straight to them.
/// @dev A claim needs an EIP-712 attestation signed by the current verifier key, which the owner can
///      rotate. The verifier service signs after checking a `_payhole` DNS TXT record on the domain
///      that names the wallet. Registration needs no stake and no token. `domainHash` is keccak256 of
///      the lowercase ASCII hostname without a trailing dot, for example keccak256("example.com").
contract CreatorRegistry is OwnerSweep, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice Registration state for one domain.
    /// @param wallet Wallet that receives tips. Zero when unclaimed.
    /// @param nonce Number of successful claims so far; the next attestation must carry this value.
    struct Creator {
        address wallet;
        uint96 nonce;
    }

    /// @notice EIP-712 type hash of the attestation the verifier signs.
    bytes32 public constant CLAIM_TYPEHASH =
        keccak256("Claim(bytes32 domainHash,address wallet,uint256 nonce,uint256 deadline)");

    /// @notice Settlement asset for tips.
    IERC20 public immutable usdg;

    /// @notice Key whose attestations are currently accepted.
    address public verifier;

    mapping(bytes32 domainHash => Creator) private _creators;

    event VerifierSet(address indexed previous, address indexed current);
    event Claimed(bytes32 indexed domainHash, address indexed wallet, uint256 nonce);
    event Tipped(bytes32 indexed domainHash, address indexed from, address indexed wallet, uint256 amount);

    error ZeroAmount();
    error AttestationExpired();
    error InvalidAttestation();
    error NotRegistered();

    /// @param usdg_ Address of the USDG token.
    /// @param verifier_ Initial verifier key.
    /// @param initialOwner Owner of the registry (the protocol Safe).
    constructor(address usdg_, address verifier_, address initialOwner)
        Ownable(initialOwner)
        EIP712("PayHoleCreatorRegistry", "1")
    {
        if (usdg_ == address(0) || verifier_ == address(0)) revert ZeroAddress();
        usdg = IERC20(usdg_);
        verifier = verifier_;
        emit VerifierSet(address(0), verifier_);
    }

    /// @notice Rotate the verifier key. Attestations from the previous key stop working at once.
    /// @param verifier_ New verifier key.
    function setVerifier(address verifier_) external onlyOwner {
        if (verifier_ == address(0)) revert ZeroAddress();
        emit VerifierSet(verifier, verifier_);
        verifier = verifier_;
    }

    /// @notice Register or update the wallet for a domain using a verifier attestation.
    /// @dev Anyone may submit; the attestation is the authority. Each attestation is bound to the
    ///      domain's current nonce, so it cannot be replayed after a later claim.
    /// @param domainHash keccak256 of the lowercase hostname.
    /// @param wallet Wallet that will receive tips.
    /// @param deadline Last unix second at which the attestation is valid.
    /// @param signature Verifier's EIP-712 signature over Claim(domainHash, wallet, nonce, deadline).
    function claim(bytes32 domainHash, address wallet, uint256 deadline, bytes calldata signature) external {
        if (wallet == address(0)) revert ZeroAddress();
        if (block.timestamp > deadline) revert AttestationExpired();
        Creator storage c = _creators[domainHash];
        uint96 nonce = c.nonce;
        bytes32 digest = _digest(domainHash, wallet, nonce, deadline);
        if (ECDSA.recover(digest, signature) != verifier) revert InvalidAttestation();
        c.wallet = wallet;
        c.nonce = nonce + 1;
        emit Claimed(domainHash, wallet, nonce);
    }

    /// @notice Send `amount` USDG from the caller straight to the wallet registered for `domainHash`.
    /// @param domainHash keccak256 of the lowercase hostname.
    /// @param amount USDG base units; the caller must have approved the registry.
    function tip(bytes32 domainHash, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        address wallet = _creators[domainHash].wallet;
        if (wallet == address(0)) revert NotRegistered();
        usdg.safeTransferFrom(msg.sender, wallet, amount);
        emit Tipped(domainHash, msg.sender, wallet, amount);
    }

    /// @notice Wallet registered for `domainHash`, or zero when unclaimed.
    function walletOf(bytes32 domainHash) external view returns (address) {
        return _creators[domainHash].wallet;
    }

    /// @notice Nonce the next attestation for `domainHash` must carry.
    function nonceOf(bytes32 domainHash) external view returns (uint256) {
        return _creators[domainHash].nonce;
    }

    /// @notice EIP-712 digest the verifier must sign to attest `domainHash -> wallet` right now.
    /// @param domainHash keccak256 of the lowercase hostname.
    /// @param wallet Wallet to attest.
    /// @param deadline Attestation expiry.
    function claimDigest(bytes32 domainHash, address wallet, uint256 deadline) external view returns (bytes32) {
        return _digest(domainHash, wallet, _creators[domainHash].nonce, deadline);
    }

    function _digest(bytes32 domainHash, address wallet, uint96 nonce, uint256 deadline)
        private
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, domainHash, wallet, uint256(nonce), deadline)));
    }
}
