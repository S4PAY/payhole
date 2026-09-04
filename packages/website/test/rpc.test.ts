import { describe, expect, it } from "vitest";
import { decodeAddress, decodeUint, encodeAddress, encodeBytes, encodeUint, formatUnits } from "../src/lib/rpc";

describe("abi helpers", () => {
  it("encodes static and dynamic values", () => {
    expect(encodeUint(255n)).toBe("0".repeat(62) + "ff");
    expect(encodeAddress("0xB22e34Fb6aa9cd0b24EB971e06BEA4f01eCa5b3d")).toBe("000000000000000000000000b22e34fb6aa9cd0b24eb971e06bea4f01eca5b3d");
    expect(encodeBytes("0x0102")).toBe(encodeUint(2n) + "0102" + "0".repeat(60));
    expect(encodeBytes("0x" + "ab".repeat(65)).length).toBe(64 + 192);
  });

  it("decodes words", () => {
    expect(decodeUint("0x" + "0".repeat(63) + "a")).toBe(10n);
    expect(decodeUint("0x")).toBe(0n);
    expect(decodeAddress("0x" + "0".repeat(24) + "b22e34fb6aa9cd0b24eb971e06bea4f01eca5b3d")).toBe("0xb22e34fb6aa9cd0b24eb971e06bea4f01eca5b3d");
  });

  it("formats token units", () => {
    expect(formatUnits(1_234_567n, 6)).toBe("1.23");
    expect(formatUnits(1_000_000n, 6)).toBe("1");
    expect(formatUnits(100n, 6, 4)).toBe("0.0001");
    expect(formatUnits(123456789000000000000000n, 18, 0)).toBe("123,456");
  });
});
