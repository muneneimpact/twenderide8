CREATE TABLE public.ride_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ride_id uuid NOT NULL REFERENCES public.rides(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('customer','driver','ops')),
  body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000),
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.ride_messages TO authenticated;
GRANT ALL ON public.ride_messages TO service_role;

ALTER TABLE public.ride_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Ride participants and staff can read messages"
ON public.ride_messages FOR SELECT TO authenticated
USING (public.can_view_ride(auth.uid(), ride_id));

CREATE POLICY "Ride participants can send their own messages"
ON public.ride_messages FOR INSERT TO authenticated
WITH CHECK (sender_id = auth.uid() AND public.can_view_ride(auth.uid(), ride_id));

CREATE POLICY "Ride participants can mark messages read"
ON public.ride_messages FOR UPDATE TO authenticated
USING (public.can_view_ride(auth.uid(), ride_id))
WITH CHECK (public.can_view_ride(auth.uid(), ride_id));

CREATE INDEX ride_messages_ride_created_idx ON public.ride_messages (ride_id, created_at);

ALTER TABLE public.ride_messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ride_messages;