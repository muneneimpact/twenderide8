INSERT INTO public.driver_vehicle_authorisations (vehicle_id, driver_id)
SELECT v.id, v.owner_driver_id
FROM public.vehicles v
WHERE v.owner_driver_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.driver_vehicle_authorisations a
    WHERE a.vehicle_id = v.id AND a.driver_id = v.owner_driver_id AND a.revoked_at IS NULL
  );