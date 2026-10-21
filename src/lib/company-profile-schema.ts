import { z } from "zod";

export const companyProfileSchema = z.object({
  companyName: z.string().trim().min(2, "Enter your company name.").max(160),
  kraPin: z.string().trim().toUpperCase().regex(
    /^[AP]\d{9}[A-Z]$/,
    "Enter a valid KRA PIN, for example P051234567X.",
  ).or(z.literal("")),
  billingEmail: z.string().trim().email("Enter a valid billing email address.").or(z.literal("")),
  registrationNumber: z.string().trim().max(80),
});

export type CompanyProfileDetails = z.infer<typeof companyProfileSchema>;