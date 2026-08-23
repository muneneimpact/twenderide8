INSERT INTO public.fare_configs (
  version, vehicle_class, base_fare, per_km, per_minute, minimum_fare, booking_fee,
  waiting_per_minute, free_waiting_minutes, cancellation_fee, cancellation_free_seconds,
  commission_percent, rounding_rule, modifier_combination, max_surcharge_percent, state, effective_from
) VALUES
  (1, 'boda',    40.00, 0.60, 0.00,  60.00,  50.00, 0.00, 0, 0.00, 0, 12.000, 'nearest_5', 'additive', 0.000, 'published', now()),
  (1, 'comfort', 95.00, 1.25, 0.00, 130.00, 120.00, 0.00, 0, 0.00, 0, 12.000, 'nearest_5', 'additive', 0.000, 'published', now()),
  (1, 'xl',     120.00, 1.60, 0.00, 170.00, 150.00, 0.00, 0, 0.00, 0, 12.000, 'nearest_5', 'additive', 0.000, 'published', now());