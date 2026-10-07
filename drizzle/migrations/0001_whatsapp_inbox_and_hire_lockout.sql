CREATE TABLE IF NOT EXISTS public.whatsapp_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone text NOT NULL UNIQUE,
  customer_name text,
  last_message_preview text,
  last_inbound_at timestamptz,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  unread_count integer NOT NULL DEFAULT 0 CHECK (unread_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.whatsapp_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  body text NOT NULL,
  message_type text NOT NULL DEFAULT 'text',
  provider_message_id text UNIQUE,
  status text NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'sending', 'sent', 'delivered', 'read', 'failed')),
  sent_by uuid,
  error_message text,
  attachment_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_conversations_last_message_idx ON public.whatsapp_conversations (last_message_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_thread_idx ON public.whatsapp_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS hire_quotes_active_vehicle_window_idx ON public.hire_quotes (vehicle_id, start_at, end_at) WHERE status IN ('submitted', 'quoted', 'confirmed');
REVOKE ALL ON public.whatsapp_conversations, public.whatsapp_messages FROM anon, authenticated;
GRANT ALL ON public.whatsapp_conversations, public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.increment_whatsapp_unread(_conversation_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.whatsapp_conversations SET unread_count = unread_count + 1 WHERE id = _conversation_id;
$$;
REVOKE ALL ON FUNCTION public.increment_whatsapp_unread(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_whatsapp_unread(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.vehicle_has_active_hire(_vehicle_id uuid, _at timestamptz DEFAULT now())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.hire_quotes q WHERE q.vehicle_id = _vehicle_id AND q.status = 'confirmed'
    AND q.start_at <= _at AND COALESCE(q.end_at, q.start_at + make_interval(days => q.days)) > _at);
$$;
REVOKE ALL ON FUNCTION public.vehicle_has_active_hire(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vehicle_has_active_hire(uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.block_ride_assignment_to_hired_vehicle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _vehicle_id uuid; _new_is_active boolean; _old_is_active boolean;
BEGIN
  _new_is_active := NEW.status::text IN ('driver_assigned','driver_arriving','driver_arrived','trip_started');
  _old_is_active := false;
  IF TG_OP = 'UPDATE' THEN
    _old_is_active := OLD.status::text IN ('driver_assigned','driver_arriving','driver_arrived','trip_started');
  END IF;
  IF NEW.driver_id IS NULL OR NOT _new_is_active THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF _old_is_active AND OLD.driver_id IS NOT DISTINCT FROM NEW.driver_id AND OLD.vehicle_id IS NOT DISTINCT FROM NEW.vehicle_id THEN
      RETURN NEW;
    END IF;
  END IF;
  _vehicle_id := NEW.vehicle_id;
  IF _vehicle_id IS NULL THEN
    SELECT active_vehicle_id INTO _vehicle_id FROM public.drivers WHERE id = NEW.driver_id;
  END IF;
  IF _vehicle_id IS NOT NULL AND public.vehicle_has_active_hire(_vehicle_id, now()) THEN
    RAISE EXCEPTION 'This vehicle is currently on hire and cannot accept rides until it is returned.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS rides_block_hired_vehicle_assignment ON public.rides;
CREATE TRIGGER rides_block_hired_vehicle_assignment BEFORE INSERT OR UPDATE OF driver_id, status, vehicle_id ON public.rides
FOR EACH ROW EXECUTE FUNCTION public.block_ride_assignment_to_hired_vehicle();

CREATE OR REPLACE FUNCTION public.block_driver_online_with_hired_vehicle()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.is_online AND NEW.active_vehicle_id IS NOT NULL AND public.vehicle_has_active_hire(NEW.active_vehicle_id, now()) THEN
    RAISE EXCEPTION 'This vehicle is currently on hire and cannot be used for rides until it is returned.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS drivers_block_hired_vehicle_online ON public.drivers;
CREATE TRIGGER drivers_block_hired_vehicle_online BEFORE INSERT OR UPDATE OF is_online, active_vehicle_id ON public.drivers
FOR EACH ROW EXECUTE FUNCTION public.block_driver_online_with_hired_vehicle();

CREATE OR REPLACE FUNCTION public.block_hire_start_during_live_ride()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'confirmed' AND NEW.vehicle_id IS NOT NULL AND NEW.start_at <= now()
     AND EXISTS (SELECT 1 FROM public.rides r WHERE r.vehicle_id = NEW.vehicle_id
       AND r.status::text IN ('driver_assigned','driver_arriving','driver_arrived','trip_started')) THEN
    RAISE EXCEPTION 'This vehicle has an active ride. The hire cannot begin until the ride is complete.';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS hire_quotes_block_live_ride_start ON public.hire_quotes;
CREATE TRIGGER hire_quotes_block_live_ride_start BEFORE INSERT OR UPDATE OF status, vehicle_id, start_at ON public.hire_quotes
FOR EACH ROW EXECUTE FUNCTION public.block_hire_start_during_live_ride();