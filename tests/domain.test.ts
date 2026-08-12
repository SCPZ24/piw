import {describe, expect, test} from "vitest";
import {naturalCompare, validateIdentifier, validateProfileName} from "../src/domain.js";

describe("identifiers", () => {
  test("accepts the v0.1 identifier grammar", () => {
    expect(validateIdentifier("builder_2")).toBe(true);
    expect(validateIdentifier("Upper")).toBe(false);
    expect(validateIdentifier("a".repeat(65))).toBe(false);
  });

  test("rejects reserved profile names", () => {
    expect(validateProfileName("doctor")).toEqual({valid: false, reason: "reserved profile name"});
    expect(validateProfileName("builder")).toEqual({valid: true});
  });
});

describe("naturalCompare", () => {
  test("sorts digit runs numerically with a deterministic code-point tie-break", () => {
    const values = ["profile_a", "profile-10", "profile-2", "x01", "x1"];
    expect(values.sort(naturalCompare)).toEqual(["profile-2", "profile-10", "profile_a", "x01", "x1"]);
  });
});
