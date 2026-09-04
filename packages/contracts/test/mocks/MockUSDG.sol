// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Test double for USDG: 6 decimals, open mint, EIP-3009 transfer and receive authorizations.
contract MockUSDG is ERC20, EIP712 {
    struct Authorization {
        address from;
        address to;
        uint256 value;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
    }

    bytes32 public constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes32 public constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    mapping(address authorizer => mapping(bytes32 nonce => bool used)) public authorizationState;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();
    error CallerMustBePayee();

    constructor() ERC20("Global Dollar", "USDG") EIP712("Global Dollar", "1") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function version() external pure returns (string memory) {
        return "1";
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _use(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            Authorization(from, to, value, validAfter, validBefore, nonce),
            abi.encodePacked(r, s, v)
        );
    }

    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        bytes calldata signature
    ) external {
        _use(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
            Authorization(from, to, value, validAfter, validBefore, nonce),
            signature
        );
    }

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (to != msg.sender) revert CallerMustBePayee();
        _use(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
            Authorization(from, to, value, validAfter, validBefore, nonce),
            abi.encodePacked(r, s, v)
        );
    }

    function _use(bytes32 typehash, Authorization memory a, bytes memory signature) private {
        if (block.timestamp <= a.validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= a.validBefore) revert AuthorizationExpired();
        if (authorizationState[a.from][a.nonce]) revert AuthorizationAlreadyUsed();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(typehash, a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce))
        );
        if (ECDSA.recover(digest, signature) != a.from) revert InvalidSignature();
        authorizationState[a.from][a.nonce] = true;
        emit AuthorizationUsed(a.from, a.nonce);
        _transfer(a.from, a.to, a.value);
    }
}
