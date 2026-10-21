import { describe, expect, it } from "vitest";
import { companyProfileSchema } from "./company-profile-schema";

describe("saved company details", () => {
  it("allows saving a company name before optional details are entered", () => {
    expect(companyProfileSchema.parse({ companyName: "Twende Business", kraPin: "", billingEmail: "", registrationNumber: "" }))
      .toEqual({ companyName: "Twende Business", kraPin: "", billingEmail: "", registrationNumber: "" });
  });
  it("preserves every completed field and normalizes the KRA PIN", () => {
    expect(companyProfileSchema.parse({ companyName: "Twende Business", kraPin: "p051234567x", billingEmail: "office@example.org", registrationNumber: "REG-123" }))
      .toEqual({ companyName: "Twende Business", kraPin: "P051234567X", billingEmail: "office@example.org", registrationNumber: "REG-123" });
  });
});