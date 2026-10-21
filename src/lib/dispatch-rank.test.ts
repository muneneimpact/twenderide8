import { describe, expect, it } from "vitest";
import { rankByEtaAndRating } from "./dispatch-rank";

describe("rating-aware dispatch", () => {
  it("a 5-star driver 1 minute further is offered before a 3-star driver", () => {
    const out = rankByEtaAndRating([
      { id: "low", eta_minutes: 4, road_km: 1, rating: 3, completed_rides: 50 },
      { id: "top", eta_minutes: 5, road_km: 1.2, rating: 5, completed_rides: 50 },
    ]);
    expect(out[0]!.id).toBe("top");
  });
  it("a much closer driver still wins over a far top-rated one", () => {
    const out = rankByEtaAndRating([
      { id: "far", eta_minutes: 15, road_km: 6, rating: 5, completed_rides: 50 },
      { id: "near", eta_minutes: 3, road_km: 1, rating: 3.5, completed_rides: 50 },
    ]);
    expect(out[0]!.id).toBe("near");
  });
  it("new drivers with few trips are not penalised by an early bad rating", () => {
    const out = rankByEtaAndRating([
      { id: "new", eta_minutes: 4, road_km: 1, rating: 1, completed_rides: 2 },
      { id: "old", eta_minutes: 5, road_km: 1, rating: 4.5, completed_rides: 80 },
    ]);
    expect(out[0]!.id).toBe("new");
  });
});
