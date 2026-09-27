import { describe, it, expect } from "vitest";
import { snapRotationToRightAngle } from "@/lib/translationOverlay";

describe("snapRotationToRightAngle", () => {
  it("snaps angles within +/- 6 degrees of 0 / 360 to 0", () => {
    expect(snapRotationToRightAngle(0)).toBe(0);
    expect(snapRotationToRightAngle(4)).toBe(0);
    expect(snapRotationToRightAngle(-4)).toBe(0);
    expect(snapRotationToRightAngle(6)).toBe(0);
    expect(snapRotationToRightAngle(-6)).toBe(0);
    expect(snapRotationToRightAngle(355)).toBe(0);
    expect(snapRotationToRightAngle(358)).toBe(0);
  });

  it("snaps angles within +/- 6 degrees of 90 to 90", () => {
    expect(snapRotationToRightAngle(90)).toBe(90);
    expect(snapRotationToRightAngle(86)).toBe(90);
    expect(snapRotationToRightAngle(94)).toBe(90);
    expect(snapRotationToRightAngle(84)).toBe(90);
    expect(snapRotationToRightAngle(96)).toBe(90);
  });

  it("snaps angles within +/- 6 degrees of 180 to 180", () => {
    expect(snapRotationToRightAngle(180)).toBe(180);
    expect(snapRotationToRightAngle(175)).toBe(180);
    expect(snapRotationToRightAngle(185)).toBe(180);
  });

  it("snaps angles within +/- 6 degrees of 270 to 270", () => {
    expect(snapRotationToRightAngle(270)).toBe(270);
    expect(snapRotationToRightAngle(265)).toBe(270);
    expect(snapRotationToRightAngle(275)).toBe(270);
  });

  it("leaves angles outside the threshold untouched with original precision", () => {
    expect(snapRotationToRightAngle(7)).toBe(7);
    expect(snapRotationToRightAngle(15.5)).toBe(15.5);
    expect(snapRotationToRightAngle(45)).toBe(45);
    expect(snapRotationToRightAngle(83)).toBe(83);
    expect(snapRotationToRightAngle(97.2)).toBe(97.2);
    expect(snapRotationToRightAngle(120)).toBe(120);
    expect(snapRotationToRightAngle(200)).toBe(200);
    expect(snapRotationToRightAngle(315)).toBe(315);
  });

  it("correctly normalizes angles greater than 360 and negative angles", () => {
    expect(snapRotationToRightAngle(364)).toBe(0);
    expect(snapRotationToRightAngle(452)).toBe(90); // 452 % 360 = 92 -> snaps to 90
    expect(snapRotationToRightAngle(-88)).toBe(270); // -88 % 360 = 272 -> snaps to 270
    expect(snapRotationToRightAngle(375)).toBe(15);  // 375 % 360 = 15 -> stays 15
  });

  it("supports a custom snap threshold if provided", () => {
    expect(snapRotationToRightAngle(10, 12)).toBe(0); // within 12 degrees
    expect(snapRotationToRightAngle(10, 5)).toBe(10); // outside 5 degrees
  });
});
