/** Independent Driver Partner Agreement shown during driver onboarding. Bump the version when text changes. */
export const DRIVER_AGREEMENT_VERSION = "2026-10-v1";
export const DRIVER_AGREEMENT_TITLE = "Independent Driver Partner Agreement & Terms of Service";

export const DRIVER_AGREEMENT_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. Parties and Acceptance",
    body: [
      "This Agreement is made between Twende Ride (\"Twende\", \"the Platform\") and the person registering as a driver partner (\"the Driver\").",
      "By ticking the acceptance box and submitting the application, the Driver confirms they have read, understood and agree to be bound by this Agreement.",
    ],
  },
  {
    heading: "2. Twende Is a Technology Intermediary",
    body: [
      "Twende provides a technology platform that connects independent drivers with riders and hirers. Twende is not a transportation provider, taxi operator, public service vehicle operator or employer.",
      "All transport services are provided by the Driver directly to the rider. Twende does not control the manner in which the Driver performs a trip beyond the platform rules in this Agreement.",
    ],
  },
  {
    heading: "3. Independent Contractor Status",
    body: [
      "The Driver is an independent contractor. Nothing in this Agreement creates an employment, partnership, joint venture or agency relationship.",
      "The Driver has no claim against Twende for salary, minimum wage, leave, overtime, severance, NSSF, SHA/NHIF contributions or any other employment benefit.",
      "The Driver is solely responsible for personal income tax, VAT where applicable, county permits, business licences and any other statutory obligations arising from their work.",
    ],
  },
  {
    heading: "4. Licences, Insurance and Vehicle Compliance",
    body: [
      "The Driver warrants that they hold, and will maintain throughout, a valid Kenyan driving licence for the vehicle class, a valid NTSA inspection certificate, PSV or commercial insurance covering passengers and third parties, a PSV badge where required, and a valid DCI Certificate of Good Conduct.",
      "The Driver is fully responsible for the roadworthiness, safety, cleanliness, servicing and legal compliance of the vehicle, and for obeying the Traffic Act (Cap 403) and NTSA regulations.",
      "The Driver must upload accurate documents and immediately notify Twende of any expiry, suspension, accident or change.",
    ],
  },
  {
    heading: "5. Fares, Commission and Remittance",
    body: [
      "Twende sets fares, including dynamic, night, weather and distant-pickup pricing. The Driver agrees to charge only the fare shown in the app.",
      "Twende deducts its service fee or commission from each trip. For trips paid in cash or by M-PESA directly to the Driver, the Driver must remit the commission owed to Twende promptly.",
      "Twende may recover any amount owed by deducting it from wallet balances or payouts, sending M-PESA payment requests, or restricting the account until the balance is settled.",
    ],
  },
  {
    heading: "6. Liability and Indemnity",
    body: [
      "The Driver indemnifies and holds Twende, its directors, staff and partners harmless against all claims, losses, damages, fines, costs and legal fees arising from the Driver's trips, conduct or vehicle, including road accidents, injury or death of passengers or third parties, theft, robbery, vehicle damage and traffic offences.",
      "To the maximum extent permitted by Kenyan law, Twende's total liability to the Driver for any trip is limited to the platform fee Twende earned on that specific trip.",
      "Nothing in this Agreement excludes liability that cannot lawfully be excluded under Kenyan law.",
    ],
  },
  {
    heading: "7. Safety and Conduct",
    body: [
      "Twende has zero tolerance for driving under the influence of alcohol or drugs, harassment, violence, discrimination, unsafe driving, fraud, and off-platform trips arranged with riders met through Twende.",
      "Twende may suspend, deactivate or terminate the Driver's access at any time where it reasonably believes this Agreement or the law has been breached, or for safety, compliance or business reasons, without compensation.",
    ],
  },
  {
    heading: "8. Data Protection",
    body: [
      "Rider personal data (names, phone numbers, locations) may be used only to complete the trip, in line with the Data Protection Act, 2019.",
      "The Driver must not save, copy, share or sell rider data, or contact riders after a trip for any purpose not related to the trip (such as returning a lost item through the app).",
    ],
  },
  {
    heading: "9. Changes and Termination",
    body: [
      "Twende may update this Agreement. Continued use of the platform after notice of an update means the Driver accepts the updated terms.",
      "Either party may end this relationship at any time. Amounts owed to Twende remain payable after termination.",
    ],
  },
  {
    heading: "10. Electronic Signature and Governing Law",
    body: [
      "The Driver agrees that electronic acceptance of this Agreement is a valid and binding electronic signature and contract under Section 83B and related provisions of the Kenya Information and Communications Act, and the Law of Contract Act (Cap 23).",
      "This Agreement is governed by the laws of Kenya. Disputes shall first be raised with Twende support and, if unresolved, referred to the courts of Kenya.",
    ],
  },
];
