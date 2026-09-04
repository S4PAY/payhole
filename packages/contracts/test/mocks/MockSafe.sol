// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stand-in for a Safe in deploy-script dry runs: answers the threshold query the scripts check.
contract MockSafe {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}
