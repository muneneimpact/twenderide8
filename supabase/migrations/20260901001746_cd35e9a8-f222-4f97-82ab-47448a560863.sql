ALTER TYPE public.vehicle_class RENAME VALUE 'economy' TO 'go';
ALTER TYPE public.vehicle_class ADD VALUE IF NOT EXISTS 'plus';
ALTER TYPE public.vehicle_class ADD VALUE IF NOT EXISTS 'e_boda';