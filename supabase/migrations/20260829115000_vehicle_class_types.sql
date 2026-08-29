-- ---------------------------------------------------------------------------
-- Vehicle class types: rename "economy" to "go" and add "plus" + "e_boda".
--
-- NOTE(lovable-backend): apply this migration to the database. It changes the
-- public `vehicle_class` Postgres enum to match the app's six branded classes.
-- The app/code already references these keys; the DB must agree for fare
-- configs, policies, quotes, modifiers and promotions to validate.
-- ---------------------------------------------------------------------------

-- 1. Add the new enum values.
ALTER TYPE vehicle_class ADD VALUE IF NOT EXISTS 'go';
ALTER TYPE vehicle_class ADD VALUE IF NOT EXISTS 'plus';
ALTER TYPE vehicle_class ADD VALUE IF NOT EXISTS 'e_boda';

-- 2. Migrate existing "economy" rows to "go".
UPDATE fare_configs      SET vehicle_class = 'go' WHERE vehicle_class = 'economy';
UPDATE distance_policies SET vehicle_class = 'go' WHERE vehicle_class = 'economy';
UPDATE pricing_modifiers SET vehicle_class = 'go' WHERE vehicle_class = 'economy';
UPDATE route_quotes      SET vehicle_class = 'go' WHERE vehicle_class = 'economy';

-- Promotions store an array of classes in a text[] column.
UPDATE promotions
SET applies_to = ARRAY(
  SELECT CASE WHEN x = 'economy' THEN 'go' ELSE x END
  FROM unnest(applies_to) AS x
)
WHERE 'economy' = ANY(applies_to);

-- ---------------------------------------------------------------------------
-- NOTE(lovable-backend): the old 'economy' value is now unused. To fully remove
-- it from the enum you must rebuild the type (not supported by ADD VALUE in the
-- same transaction). If you want a clean enum, run this separately:
--
--   ALTER TABLE fare_configs      ALTER COLUMN vehicle_class TYPE text;
--   ALTER TABLE distance_policies ALTER COLUMN vehicle_class TYPE text;
--   ALTER TABLE pricing_modifiers ALTER COLUMN vehicle_class TYPE text;
--   ALTER TABLE route_quotes      ALTER COLUMN vehicle_class TYPE text;
--   DROP TYPE vehicle_class;
--   CREATE TYPE vehicle_class AS ENUM ('go','plus','comfort','xl','boda','e_boda');
--   ALTER TABLE fare_configs      ALTER COLUMN vehicle_class TYPE vehicle_class USING vehicle_class::vehicle_class;
--   ALTER TABLE distance_policies ALTER COLUMN vehicle_class TYPE vehicle_class USING vehicle_class::vehicle_class;
--   ALTER TABLE pricing_modifiers ALTER COLUMN vehicle_class TYPE vehicle_class USING vehicle_class::vehicle_class;
--   ALTER TABLE route_quotes      ALTER COLUMN vehicle_class TYPE vehicle_class USING vehicle_class::vehicle_class;
-- ---------------------------------------------------------------------------
