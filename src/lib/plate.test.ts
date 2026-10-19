import { describe, expect, it } from "vitest";
import { formatKenyanPlate, isValidKenyanPlate } from "./plate";

describe("plates", () => {
  it("formats motorcycle plates like KMGT 156X", () => {
    expect(formatKenyanPlate("kmgt156x")).toBe("KMGT 156X");
    expect(isValidKenyanPlate("KMGT 156X")).toBe(true);
  });
  it("still formats car plates like KDG 568T", () => {
    expect(formatKenyanPlate("kdg568t")).toBe("KDG 568T");
  });
});
