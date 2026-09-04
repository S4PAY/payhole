// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {CreatorRegistry} from "../src/CreatorRegistry.sol";
import {OwnerSweep} from "../src/base/OwnerSweep.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract CreatorRegistryTest is Test {
    MockUSDG internal usdg;
    CreatorRegistry internal registry;

    address internal safe = makeAddr("safe");
    address internal verifier;
    uint256 internal verifierPk;
    address internal creator = makeAddr("creator");
    address internal tipper = makeAddr("tipper");
    bytes32 internal constant DOMAIN = keccak256("example.com");

    function setUp() public {
        (verifier, verifierPk) = makeAddrAndKey("verifier");
        usdg = new MockUSDG();
        registry = new CreatorRegistry(address(usdg), verifier, safe);
        usdg.mint(tipper, 1000e6);
        vm.prank(tipper);
        usdg.approve(address(registry), type(uint256).max);
    }

    function _attest(uint256 pk, bytes32 domainHash, address wallet, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, registry.claimDigest(domainHash, wallet, deadline));
        return abi.encodePacked(r, s, v);
    }

    function test_constructor() public view {
        assertEq(registry.owner(), safe);
        assertEq(registry.verifier(), verifier);
        assertEq(address(registry.usdg()), address(usdg));
    }

    function test_constructor_zeroAddressesRevert() public {
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        new CreatorRegistry(address(0), verifier, safe);
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        new CreatorRegistry(address(usdg), address(0), safe);
    }

    function test_digestMatchesEip712Encoding() public view {
        (, string memory name, string memory version, uint256 chainId, address verifying,,) = registry.eip712Domain();
        assertEq(name, "PayHoleCreatorRegistry");
        assertEq(version, "1");
        assertEq(verifying, address(registry));
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifying
            )
        );
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(abi.encode(registry.CLAIM_TYPEHASH(), DOMAIN, creator, uint256(0), deadline));
        assertEq(
            registry.claimDigest(DOMAIN, creator, deadline),
            keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
        );
    }

    function test_claim_goodAttestation() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _attest(verifierPk, DOMAIN, creator, deadline);
        vm.expectEmit(address(registry));
        emit CreatorRegistry.Claimed(DOMAIN, creator, 0);
        registry.claim(DOMAIN, creator, deadline, sig);
        assertEq(registry.walletOf(DOMAIN), creator);
        assertEq(registry.nonceOf(DOMAIN), 1);
    }

    function test_claim_badSignerRejected() public {
        (, uint256 impostorPk) = makeAddrAndKey("impostor");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _attest(impostorPk, DOMAIN, creator, deadline);
        vm.expectRevert(CreatorRegistry.InvalidAttestation.selector);
        registry.claim(DOMAIN, creator, deadline, sig);
        assertEq(registry.walletOf(DOMAIN), address(0));
    }

    function test_claim_tamperedFieldsRejected() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _attest(verifierPk, DOMAIN, creator, deadline);
        vm.expectRevert(CreatorRegistry.InvalidAttestation.selector);
        registry.claim(DOMAIN, tipper, deadline, sig);
        vm.expectRevert(CreatorRegistry.InvalidAttestation.selector);
        registry.claim(keccak256("other.com"), creator, deadline, sig);
        vm.expectRevert(CreatorRegistry.InvalidAttestation.selector);
        registry.claim(DOMAIN, creator, deadline + 1, sig);
    }

    function test_claim_malformedSignatureReverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        vm.expectRevert(abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureLength.selector, 3));
        registry.claim(DOMAIN, creator, deadline, hex"010203");
    }

    function test_claim_expiredRejected() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _attest(verifierPk, DOMAIN, creator, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(CreatorRegistry.AttestationExpired.selector);
        registry.claim(DOMAIN, creator, deadline, sig);
    }

    function test_claim_zeroWalletRejected() public {
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        registry.claim(DOMAIN, address(0), block.timestamp + 1, hex"");
    }

    function test_claim_replayRejectedByNonce() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _attest(verifierPk, DOMAIN, creator, deadline);
        registry.claim(DOMAIN, creator, deadline, sig);
        vm.expectRevert(CreatorRegistry.InvalidAttestation.selector);
        registry.claim(DOMAIN, creator, deadline, sig);
    }

    function test_claim_rotateWalletWithFreshAttestation() public {
        uint256 deadline = block.timestamp + 1 hours;
        registry.claim(DOMAIN, creator, deadline, _attest(verifierPk, DOMAIN, creator, deadline));
        address newWallet = makeAddr("newWallet");
        bytes memory sig = _attest(verifierPk, DOMAIN, newWallet, deadline);
        vm.expectEmit(address(registry));
        emit CreatorRegistry.Claimed(DOMAIN, newWallet, 1);
        registry.claim(DOMAIN, newWallet, deadline, sig);
        assertEq(registry.walletOf(DOMAIN), newWallet);
        assertEq(registry.nonceOf(DOMAIN), 2);
    }

    function test_setVerifier_rotationInvalidatesOldKey() public {
        (address newVerifier, uint256 newPk) = makeAddrAndKey("verifier2");
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory oldSig = _attest(verifierPk, DOMAIN, creator, deadline);
        vm.expectEmit(address(registry));
        emit CreatorRegistry.VerifierSet(verifier, newVerifier);
        vm.prank(safe);
        registry.setVerifier(newVerifier);
        vm.expectRevert(CreatorRegistry.InvalidAttestation.selector);
        registry.claim(DOMAIN, creator, deadline, oldSig);
        registry.claim(DOMAIN, creator, deadline, _attest(newPk, DOMAIN, creator, deadline));
        assertEq(registry.walletOf(DOMAIN), creator);
    }

    function test_setVerifier_onlyOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, creator));
        vm.prank(creator);
        registry.setVerifier(creator);
        vm.expectRevert(OwnerSweep.ZeroAddress.selector);
        vm.prank(safe);
        registry.setVerifier(address(0));
    }

    function test_tip_landsInMappedWallet() public {
        uint256 deadline = block.timestamp + 1 hours;
        registry.claim(DOMAIN, creator, deadline, _attest(verifierPk, DOMAIN, creator, deadline));
        vm.expectEmit(address(registry));
        emit CreatorRegistry.Tipped(DOMAIN, tipper, creator, 0.05e6);
        vm.prank(tipper);
        registry.tip(DOMAIN, 0.05e6);
        assertEq(usdg.balanceOf(creator), 0.05e6);
        assertEq(usdg.balanceOf(address(registry)), 0);
        assertEq(usdg.balanceOf(tipper), 1000e6 - 0.05e6);
    }

    function test_tip_unregisteredReverts() public {
        vm.expectRevert(CreatorRegistry.NotRegistered.selector);
        vm.prank(tipper);
        registry.tip(DOMAIN, 1e6);
    }

    function test_tip_zeroReverts() public {
        vm.expectRevert(CreatorRegistry.ZeroAmount.selector);
        vm.prank(tipper);
        registry.tip(DOMAIN, 0);
    }

    function testFuzz_tip_movesExactAmount(uint96 amount) public {
        amount = uint96(bound(amount, 1, 1000e6));
        uint256 deadline = block.timestamp + 1 hours;
        registry.claim(DOMAIN, creator, deadline, _attest(verifierPk, DOMAIN, creator, deadline));
        vm.prank(tipper);
        registry.tip(DOMAIN, amount);
        assertEq(usdg.balanceOf(creator), amount);
    }

    function test_sweep_ownerOnly() public {
        usdg.mint(address(registry), 2e6);
        vm.deal(address(registry), 1 ether);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, tipper));
        vm.prank(tipper);
        registry.sweepETH(tipper, 1 ether);
        vm.startPrank(safe);
        registry.sweep(address(usdg), creator, 2e6);
        registry.sweepETH(creator, 1 ether);
        vm.stopPrank();
        assertEq(usdg.balanceOf(creator), 2e6);
        assertEq(creator.balance, 1 ether);
    }
}
