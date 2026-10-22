import { queryOptions } from "@tanstack/react-query";
import { listPublicHireVehicles } from "@/lib/hire.functions";

export const publicCarsQuery = queryOptions({
  queryKey: ["public-hire-cars"],
  queryFn: () => listPublicHireVehicles(),
  staleTime: 60_000,
});
