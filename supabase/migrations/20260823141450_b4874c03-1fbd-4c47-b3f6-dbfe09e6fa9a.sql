ALTER TABLE public.document_types ADD COLUMN IF NOT EXISTS requires_image boolean NOT NULL DEFAULT false;

UPDATE public.document_types SET required = true, requires_image = true WHERE code IN ('national_id','driving_licence','good_conduct');
UPDATE public.document_types SET required = false, requires_image = false WHERE code NOT IN ('national_id','driving_licence','good_conduct');

-- Correct per-kilometre rates (previous rows stored a 1.00 multiplier by mistake).
UPDATE public.fare_configs SET state = 'archived', effective_to = now() WHERE state = 'published';

INSERT INTO public.fare_configs (
  version, vehicle_class, base_fare, per_km, per_minute, minimum_fare, booking_fee,
  waiting_per_minute, free_waiting_minutes, cancellation_fee, cancellation_free_seconds,
  commission_percent, rounding_rule, modifier_combination, max_surcharge_percent, state, effective_from
)
SELECT
  (SELECT coalesce(max(version),0) + 1 FROM public.fare_configs f2 WHERE f2.vehicle_class = v.vehicle_class),
  v.vehicle_class, 0, v.per_km, 0, v.minimum_fare, 0, 5, 3, 100, 120, 15,
  'nearest_5', 'additive', 50, 'published', now()
FROM (VALUES
  ('boda'::vehicle_class, 30::numeric, 80::numeric),
  ('economy'::vehicle_class, 78::numeric, 200::numeric),
  ('comfort'::vehicle_class, 95::numeric, 250::numeric),
  ('xl'::vehicle_class, 120::numeric, 320::numeric)
) AS v(vehicle_class, per_km, minimum_fare);

-- Long-distance reduction plan.
UPDATE public.distance_policies SET state = 'archived', effective_to = now() WHERE state = 'published';

WITH p AS (
  INSERT INTO public.distance_policies (name, version, state, max_total_reduction_percent, effective_from, published_at)
  VALUES ('Long-distance reduction',
          (SELECT coalesce(max(version),0) + 1 FROM public.distance_policies),
          'published', 20, now(), now())
  RETURNING id
)
INSERT INTO public.distance_bands (policy_id, sort_order, admin_label, customer_explanation, lower_km, upper_km, start_reduction_percent, end_reduction_percent, mode)
SELECT p.id, b.sort_order, b.admin_label, b.customer_explanation, b.lower_km, b.upper_km, b.start_pct, b.end_pct, b.mode
FROM p, (VALUES
  (1, 'Town trips (0-10 km)', 'Standard town rate.', 0::numeric, 10::numeric, 0::numeric, 0::numeric, 'fixed'),
  (2, 'Growing reduction (10-40 km)', 'The further you go, the cheaper each extra kilometre becomes.', 10::numeric, 40::numeric, 0::numeric, 15::numeric, 'linear'),
  (3, 'Long haul (40 km+)', 'Every kilometre past 40 km keeps the best long-distance rate.', 40::numeric, NULL::numeric, 15::numeric, 15::numeric, 'fixed')
) AS b(sort_order, admin_label, customer_explanation, lower_km, upper_km, start_pct, end_pct, mode);

INSERT INTO public.system_settings (key, value, description) VALUES
  ('random_discount_max_percent', '20'::jsonb, 'Largest random customer discount, in percent.'),
  ('random_discount_chance_percent', '35'::jsonb, 'Chance that a customer sees a random discount on a given day.')
ON CONFLICT (key) DO UPDATE SET value = excluded.value, description = excluded.description;