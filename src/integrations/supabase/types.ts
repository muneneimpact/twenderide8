export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json
        }
        Relationships: []
      }
      comms_log: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          delivered_at: string | null
          error_description: string | null
          event_type: string
          id: string
          idempotency_key: string
          network_id: string | null
          payment_intent_id: string | null
          provider: string
          provider_message_id: string | null
          recipient: string
          response_code: string | null
          ride_id: string | null
          sent_at: string | null
          status: string
          support_case_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          delivered_at?: string | null
          error_description?: string | null
          event_type: string
          id?: string
          idempotency_key: string
          network_id?: string | null
          payment_intent_id?: string | null
          provider: string
          provider_message_id?: string | null
          recipient: string
          response_code?: string | null
          ride_id?: string | null
          sent_at?: string | null
          status?: string
          support_case_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          delivered_at?: string | null
          error_description?: string | null
          event_type?: string
          id?: string
          idempotency_key?: string
          network_id?: string | null
          payment_intent_id?: string | null
          provider?: string
          provider_message_id?: string | null
          recipient?: string
          response_code?: string | null
          ride_id?: string | null
          sent_at?: string | null
          status?: string
          support_case_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "comms_log_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comms_log_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      distance_bands: {
        Row: {
          admin_label: string
          created_at: string
          customer_explanation: string | null
          end_reduction_percent: number
          id: string
          lower_km: number
          mode: string
          policy_id: string
          sort_order: number
          start_reduction_percent: number
          upper_km: number | null
        }
        Insert: {
          admin_label: string
          created_at?: string
          customer_explanation?: string | null
          end_reduction_percent?: number
          id?: string
          lower_km: number
          mode?: string
          policy_id: string
          sort_order: number
          start_reduction_percent?: number
          upper_km?: number | null
        }
        Update: {
          admin_label?: string
          created_at?: string
          customer_explanation?: string | null
          end_reduction_percent?: number
          id?: string
          lower_km?: number
          mode?: string
          policy_id?: string
          sort_order?: number
          start_reduction_percent?: number
          upper_km?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "distance_bands_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "distance_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      distance_policies: {
        Row: {
          admin_notes: string | null
          created_at: string
          effective_from: string | null
          effective_to: string | null
          id: string
          max_total_reduction_percent: number
          name: string
          published_at: string | null
          published_by: string | null
          state: Database["public"]["Enums"]["policy_state"]
          vehicle_class: Database["public"]["Enums"]["vehicle_class"] | null
          version: number
          zone_id: string | null
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          max_total_reduction_percent?: number
          name: string
          published_at?: string | null
          published_by?: string | null
          state?: Database["public"]["Enums"]["policy_state"]
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"] | null
          version: number
          zone_id?: string | null
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          effective_from?: string | null
          effective_to?: string | null
          id?: string
          max_total_reduction_percent?: number
          name?: string
          published_at?: string | null
          published_by?: string | null
          state?: Database["public"]["Enums"]["policy_state"]
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"] | null
          version?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "distance_policies_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "service_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      document_types: {
        Row: {
          active: boolean
          applies_to: string
          code: string
          created_at: string
          expires: boolean
          id: string
          label: string
          reminder_days: number
          required: boolean
          requires_image: boolean
        }
        Insert: {
          active?: boolean
          applies_to: string
          code: string
          created_at?: string
          expires?: boolean
          id?: string
          label: string
          reminder_days?: number
          required?: boolean
          requires_image?: boolean
        }
        Update: {
          active?: boolean
          applies_to?: string
          code?: string
          created_at?: string
          expires?: boolean
          id?: string
          label?: string
          reminder_days?: number
          required?: boolean
          requires_image?: boolean
        }
        Relationships: []
      }
      documents: {
        Row: {
          created_at: string
          document_type_id: string
          expires_on: string | null
          file_path: string | null
          id: string
          issued_on: string | null
          reference: string | null
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["approval_state"]
          subject_fleet_id: string | null
          subject_user_id: string | null
          subject_vehicle_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_type_id: string
          expires_on?: string | null
          file_path?: string | null
          id?: string
          issued_on?: string | null
          reference?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_state"]
          subject_fleet_id?: string | null
          subject_user_id?: string | null
          subject_vehicle_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_type_id?: string
          expires_on?: string | null
          file_path?: string | null
          id?: string
          issued_on?: string | null
          reference?: string | null
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_state"]
          subject_fleet_id?: string | null
          subject_user_id?: string | null
          subject_vehicle_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_document_type_id_fkey"
            columns: ["document_type_id"]
            isOneToOne: false
            referencedRelation: "document_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_subject_fleet_id_fkey"
            columns: ["subject_fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_subject_vehicle_id_fkey"
            columns: ["subject_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_offers: {
        Row: {
          created_at: string
          distance_km: number | null
          driver_id: string
          eta_minutes: number | null
          expires_at: string
          id: string
          responded_at: string | null
          ride_id: string
          status: string
          vehicle_id: string | null
        }
        Insert: {
          created_at?: string
          distance_km?: number | null
          driver_id: string
          eta_minutes?: number | null
          expires_at: string
          id?: string
          responded_at?: string | null
          ride_id: string
          status?: string
          vehicle_id?: string | null
        }
        Update: {
          created_at?: string
          distance_km?: number | null
          driver_id?: string
          eta_minutes?: number | null
          expires_at?: string
          id?: string
          responded_at?: string | null
          ride_id?: string
          status?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "driver_offers_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "driver_offers_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      driver_vehicle_authorisations: {
        Row: {
          created_at: string
          driver_id: string
          granted_by: string | null
          id: string
          revoked_at: string | null
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          vehicle_id: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          granted_by?: string | null
          id?: string
          revoked_at?: string | null
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "driver_vehicle_authorisations_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      drivers: {
        Row: {
          active_vehicle_id: string | null
          cash_jobs_blocked: boolean
          completed_rides: number
          created_at: string
          id: string
          is_online: boolean
          last_accuracy_m: number | null
          last_lat: number | null
          last_lng: number | null
          last_location_at: string | null
          rating: number
          status: Database["public"]["Enums"]["approval_state"]
          updated_at: string
        }
        Insert: {
          active_vehicle_id?: string | null
          cash_jobs_blocked?: boolean
          completed_rides?: number
          created_at?: string
          id: string
          is_online?: boolean
          last_accuracy_m?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["approval_state"]
          updated_at?: string
        }
        Update: {
          active_vehicle_id?: string | null
          cash_jobs_blocked?: boolean
          completed_rides?: number
          created_at?: string
          id?: string
          is_online?: boolean
          last_accuracy_m?: number | null
          last_lat?: number | null
          last_lng?: number | null
          last_location_at?: string | null
          rating?: number
          status?: Database["public"]["Enums"]["approval_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "drivers_active_vehicle_id_fkey"
            columns: ["active_vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      fare_configs: {
        Row: {
          base_fare: number
          booking_fee: number
          cancellation_fee: number
          cancellation_free_seconds: number
          commission_percent: number
          created_at: string
          created_by: string | null
          effective_from: string
          effective_to: string | null
          free_waiting_minutes: number
          id: string
          max_surcharge_percent: number
          minimum_fare: number
          modifier_combination: string
          per_km: number
          per_minute: number
          rounding_rule: string
          state: Database["public"]["Enums"]["policy_state"]
          vehicle_class: Database["public"]["Enums"]["vehicle_class"]
          version: number
          waiting_per_minute: number
          zone_id: string | null
        }
        Insert: {
          base_fare?: number
          booking_fee?: number
          cancellation_fee?: number
          cancellation_free_seconds?: number
          commission_percent?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          free_waiting_minutes?: number
          id?: string
          max_surcharge_percent?: number
          minimum_fare?: number
          modifier_combination?: string
          per_km?: number
          per_minute?: number
          rounding_rule?: string
          state?: Database["public"]["Enums"]["policy_state"]
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
          version: number
          waiting_per_minute?: number
          zone_id?: string | null
        }
        Update: {
          base_fare?: number
          booking_fee?: number
          cancellation_fee?: number
          cancellation_free_seconds?: number
          commission_percent?: number
          created_at?: string
          created_by?: string | null
          effective_from?: string
          effective_to?: string | null
          free_waiting_minutes?: number
          id?: string
          max_surcharge_percent?: number
          minimum_fare?: number
          modifier_combination?: string
          per_km?: number
          per_minute?: number
          rounding_rule?: string
          state?: Database["public"]["Enums"]["policy_state"]
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
          version?: number
          waiting_per_minute?: number
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fare_configs_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "service_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      fleet_memberships: {
        Row: {
          created_at: string
          driver_id: string
          fleet_id: string
          id: string
          status: string
        }
        Insert: {
          created_at?: string
          driver_id: string
          fleet_id: string
          id?: string
          status?: string
        }
        Update: {
          created_at?: string
          driver_id?: string
          fleet_id?: string
          id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_memberships_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      fleets: {
        Row: {
          business_name: string
          cash_commission_liability: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          driver_split_percent: number
          id: string
          owner_id: string
          registration_number: string | null
          settlement_mode: string
          status: Database["public"]["Enums"]["approval_state"]
          updated_at: string
        }
        Insert: {
          business_name: string
          cash_commission_liability?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          driver_split_percent?: number
          id?: string
          owner_id: string
          registration_number?: string | null
          settlement_mode?: string
          status?: Database["public"]["Enums"]["approval_state"]
          updated_at?: string
        }
        Update: {
          business_name?: string
          cash_commission_liability?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          driver_split_percent?: number
          id?: string
          owner_id?: string
          registration_number?: string | null
          settlement_mode?: string
          status?: Database["public"]["Enums"]["approval_state"]
          updated_at?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          description: string
          id: string
          reporter_id: string
          resolution: string | null
          ride_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category: string
          created_at?: string
          description: string
          id?: string
          reporter_id: string
          resolution?: string | null
          ride_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          reporter_id?: string
          resolution?: string | null
          ride_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "incidents_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_outbox: {
        Row: {
          attempts: number
          body: string
          channel: string
          created_at: string
          dedupe_key: string | null
          id: string
          last_error: string | null
          payload: Json
          provider_ready: boolean
          read_at: string | null
          ride_id: string | null
          sent_at: string | null
          status: string
          template_code: string
          title: string | null
          user_id: string | null
        }
        Insert: {
          attempts?: number
          body: string
          channel: string
          created_at?: string
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          provider_ready?: boolean
          read_at?: string | null
          ride_id?: string | null
          sent_at?: string | null
          status?: string
          template_code: string
          title?: string | null
          user_id?: string | null
        }
        Update: {
          attempts?: number
          body?: string
          channel?: string
          created_at?: string
          dedupe_key?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          provider_ready?: boolean
          read_at?: string | null
          ride_id?: string | null
          sent_at?: string | null
          status?: string
          template_code?: string
          title?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_outbox_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          email_enabled: boolean
          push_enabled: boolean
          push_permission: string
          sms_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          email_enabled?: boolean
          push_enabled?: boolean
          push_permission?: string
          sms_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          email_enabled?: boolean
          push_enabled?: boolean
          push_permission?: string
          sms_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          created_at: string
          dedupe_key: string
          event_type: string
          id: string
          payload: Json
          payment_intent_id: string | null
          provider: string
          provider_reference: string | null
          verified: boolean
        }
        Insert: {
          created_at?: string
          dedupe_key: string
          event_type: string
          id?: string
          payload?: Json
          payment_intent_id?: string | null
          provider: string
          provider_reference?: string | null
          verified?: boolean
        }
        Update: {
          created_at?: string
          dedupe_key?: string
          event_type?: string
          id?: string
          payload?: Json
          payment_intent_id?: string | null
          provider?: string
          provider_reference?: string | null
          verified?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "payment_events_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_intents: {
        Row: {
          amount: number
          created_at: string
          currency: string
          customer_id: string
          failure_reason: string | null
          id: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          mode: string
          msisdn: string | null
          provider: string
          provider_reference: string | null
          provider_request: Json
          provider_response: Json
          ride_id: string
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          customer_id: string
          failure_reason?: string | null
          id?: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          mode?: string
          msisdn?: string | null
          provider?: string
          provider_reference?: string | null
          provider_request?: Json
          provider_response?: Json
          ride_id: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          customer_id?: string
          failure_reason?: string | null
          id?: string
          idempotency_key?: string
          method?: Database["public"]["Enums"]["payment_method"]
          mode?: string
          msisdn?: string | null
          provider?: string
          provider_reference?: string | null
          provider_request?: Json
          provider_response?: Json
          ride_id?: string
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_login_otps: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_sent_at: string
          max_attempts: number
          phone: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_sent_at?: string
          max_attempts?: number
          phone: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_sent_at?: string
          max_attempts?: number
          phone?: string
        }
        Relationships: []
      }
      phone_verifications: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          last_sent_at: string
          max_attempts: number
          phone: string
          user_id: string
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          last_sent_at?: string
          max_attempts?: number
          phone: string
          user_id: string
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          last_sent_at?: string
          max_attempts?: number
          phone?: string
          user_id?: string
        }
        Relationships: []
      }
      pricing_modifiers: {
        Row: {
          activation: string
          active: boolean
          applies_to_base: string
          code: string
          created_at: string
          customer_label: string
          explanation: string | null
          id: string
          percent: number
          state: Database["public"]["Enums"]["policy_state"]
          vehicle_class: Database["public"]["Enums"]["vehicle_class"] | null
          window_end: string | null
          window_start: string | null
          zone_id: string | null
        }
        Insert: {
          activation?: string
          active?: boolean
          applies_to_base?: string
          code: string
          created_at?: string
          customer_label: string
          explanation?: string | null
          id?: string
          percent: number
          state?: Database["public"]["Enums"]["policy_state"]
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"] | null
          window_end?: string | null
          window_start?: string | null
          zone_id?: string | null
        }
        Update: {
          activation?: string
          active?: boolean
          applies_to_base?: string
          code?: string
          created_at?: string
          customer_label?: string
          explanation?: string | null
          id?: string
          percent?: number
          state?: Database["public"]["Enums"]["policy_state"]
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"] | null
          window_end?: string | null
          window_start?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pricing_modifiers_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "service_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          locale: string
          password_set_at: string | null
          phone: string | null
          phone_verified_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          locale?: string
          password_set_at?: string | null
          phone?: string | null
          phone_verified_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          locale?: string
          password_set_at?: string | null
          phone?: string | null
          phone_verified_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      push_devices: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          keys: Json
          last_seen_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          keys?: Json
          last_seen_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          keys?: Json
          last_seen_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      ratings: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          ratee_id: string
          rater_id: string
          ride_id: string
          score: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          ratee_id: string
          rater_id: string
          ride_id: string
          score: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          ratee_id?: string
          rater_id?: string
          ride_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "ratings_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      refunds: {
        Row: {
          amount: number
          approved_by: string | null
          created_at: string
          id: string
          idempotency_key: string
          payment_intent_id: string | null
          provider_reference: string | null
          reason: string | null
          ride_id: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          approved_by?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          payment_intent_id?: string | null
          provider_reference?: string | null
          reason?: string | null
          ride_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          approved_by?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          payment_intent_id?: string | null
          provider_reference?: string | null
          reason?: string | null
          ride_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "refunds_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_locations: {
        Row: {
          accuracy_m: number | null
          driver_id: string
          eta_minutes: number | null
          heading: number | null
          id: number
          lat: number
          lng: number
          purge_after: string | null
          recorded_at: string
          ride_id: string
          speed_kph: number | null
        }
        Insert: {
          accuracy_m?: number | null
          driver_id: string
          eta_minutes?: number | null
          heading?: number | null
          id?: number
          lat: number
          lng: number
          purge_after?: string | null
          recorded_at?: string
          ride_id: string
          speed_kph?: number | null
        }
        Update: {
          accuracy_m?: number | null
          driver_id?: string
          eta_minutes?: number | null
          heading?: number | null
          id?: number
          lat?: number
          lng?: number
          purge_after?: string | null
          recorded_at?: string
          ride_id?: string
          speed_kph?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ride_locations_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          read_at: string | null
          ride_id: string
          sender_id: string
          sender_role: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          read_at?: string | null
          ride_id: string
          sender_id: string
          sender_role: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          read_at?: string | null
          ride_id?: string
          sender_id?: string
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "ride_messages_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      ride_status_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          created_at: string
          id: string
          metadata: Json
          note: string | null
          ride_id: string
          status: Database["public"]["Enums"]["ride_status"]
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note?: string | null
          ride_id: string
          status: Database["public"]["Enums"]["ride_status"]
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          id?: string
          metadata?: Json
          note?: string | null
          ride_id?: string
          status?: Database["public"]["Enums"]["ride_status"]
        }
        Relationships: [
          {
            foreignKeyName: "ride_status_events_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      rides: {
        Row: {
          assigned_at: string | null
          assignment_expires_at: string | null
          cancellation_fee: number
          cancellation_policy_snapshot: Json
          cancellation_reason: string | null
          cancelled_by: string | null
          commission_amount: number
          commission_percent: number
          completed_at: string | null
          customer_id: string
          driver_id: string | null
          fare_snapshot: Json
          fleet_id: string | null
          id: string
          idempotency_key: string
          ledger_posted_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          quote_id: string
          reference: string
          requested_at: string
          settlement_snapshot: Json
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          total_fare: number
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          assigned_at?: string | null
          assignment_expires_at?: string | null
          cancellation_fee?: number
          cancellation_policy_snapshot?: Json
          cancellation_reason?: string | null
          cancelled_by?: string | null
          commission_amount: number
          commission_percent: number
          completed_at?: string | null
          customer_id: string
          driver_id?: string | null
          fare_snapshot: Json
          fleet_id?: string | null
          id?: string
          idempotency_key: string
          ledger_posted_at?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          quote_id: string
          reference?: string
          requested_at?: string
          settlement_snapshot?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          total_fare: number
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          assigned_at?: string | null
          assignment_expires_at?: string | null
          cancellation_fee?: number
          cancellation_policy_snapshot?: Json
          cancellation_reason?: string | null
          cancelled_by?: string | null
          commission_amount?: number
          commission_percent?: number
          completed_at?: string | null
          customer_id?: string
          driver_id?: string | null
          fare_snapshot?: Json
          fleet_id?: string | null
          id?: string
          idempotency_key?: string
          ledger_posted_at?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          payment_status?: Database["public"]["Enums"]["payment_status"]
          quote_id?: string
          reference?: string
          requested_at?: string
          settlement_snapshot?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          total_fare?: number
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rides_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rides_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "route_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rides_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      route_quotes: {
        Row: {
          accepted_at: string | null
          breakdown: Json
          created_at: string
          currency: string
          customer_id: string
          distance_km: number
          distance_policy_id: string | null
          dropoff_address: string | null
          dropoff_lat: number
          dropoff_lng: number
          duration_minutes: number
          expires_at: string
          fare_config_id: string | null
          id: string
          pickup_address: string | null
          pickup_lat: number
          pickup_lng: number
          pickup_notes: string | null
          polyline: string | null
          pricing_snapshot: Json
          route_provider: string
          route_response: Json
          total_fare: number
          unrounded_total: number
          vehicle_class: Database["public"]["Enums"]["vehicle_class"]
        }
        Insert: {
          accepted_at?: string | null
          breakdown: Json
          created_at?: string
          currency?: string
          customer_id: string
          distance_km: number
          distance_policy_id?: string | null
          dropoff_address?: string | null
          dropoff_lat: number
          dropoff_lng: number
          duration_minutes: number
          expires_at: string
          fare_config_id?: string | null
          id?: string
          pickup_address?: string | null
          pickup_lat: number
          pickup_lng: number
          pickup_notes?: string | null
          polyline?: string | null
          pricing_snapshot: Json
          route_provider?: string
          route_response?: Json
          total_fare: number
          unrounded_total: number
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
        }
        Update: {
          accepted_at?: string | null
          breakdown?: Json
          created_at?: string
          currency?: string
          customer_id?: string
          distance_km?: number
          distance_policy_id?: string | null
          dropoff_address?: string | null
          dropoff_lat?: number
          dropoff_lng?: number
          duration_minutes?: number
          expires_at?: string
          fare_config_id?: string | null
          id?: string
          pickup_address?: string | null
          pickup_lat?: number
          pickup_lng?: number
          pickup_notes?: string | null
          polyline?: string | null
          pricing_snapshot?: Json
          route_provider?: string
          route_response?: Json
          total_fare?: number
          unrounded_total?: number
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
        }
        Relationships: [
          {
            foreignKeyName: "route_quotes_distance_policy_id_fkey"
            columns: ["distance_policy_id"]
            isOneToOne: false
            referencedRelation: "distance_policies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_quotes_fare_config_id_fkey"
            columns: ["fare_config_id"]
            isOneToOne: false
            referencedRelation: "fare_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_places: {
        Row: {
          address: string | null
          created_at: string
          id: string
          label: string
          lat: number
          lng: number
          notes: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          created_at?: string
          id?: string
          label: string
          lat: number
          lng: number
          notes?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          created_at?: string
          id?: string
          label?: string
          lat?: number
          lng?: number
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      service_zones: {
        Row: {
          active: boolean
          centre_lat: number
          centre_lng: number
          created_at: string
          id: string
          name: string
          radius_km: number
        }
        Insert: {
          active?: boolean
          centre_lat: number
          centre_lng: number
          created_at?: string
          id?: string
          name: string
          radius_km: number
        }
        Update: {
          active?: boolean
          centre_lat?: number
          centre_lng?: number
          created_at?: string
          id?: string
          name?: string
          radius_km?: number
        }
        Relationships: []
      }
      system_settings: {
        Row: {
          description: string | null
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description?: string | null
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string | null
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          active_driver_id: string | null
          colour: string | null
          created_at: string
          fleet_id: string | null
          id: string
          make: string | null
          model: string | null
          owner_driver_id: string | null
          plate_number: string
          status: Database["public"]["Enums"]["approval_state"]
          updated_at: string
          vehicle_class: Database["public"]["Enums"]["vehicle_class"]
          year: number | null
        }
        Insert: {
          active_driver_id?: string | null
          colour?: string | null
          created_at?: string
          fleet_id?: string | null
          id?: string
          make?: string | null
          model?: string | null
          owner_driver_id?: string | null
          plate_number: string
          status?: Database["public"]["Enums"]["approval_state"]
          updated_at?: string
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
          year?: number | null
        }
        Update: {
          active_driver_id?: string | null
          colour?: string | null
          created_at?: string
          fleet_id?: string | null
          id?: string
          make?: string | null
          model?: string | null
          owner_driver_id?: string | null
          plate_number?: string
          status?: Database["public"]["Enums"]["approval_state"]
          updated_at?: string
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallet_ledger: {
        Row: {
          actor_id: string | null
          amount: number
          created_at: string
          currency: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id: string
          idempotency_key: string
          metadata: Json
          payment_intent_id: string | null
          reason: string | null
          ride_id: string | null
          source: string
          wallet_id: string
          withdrawal_id: string | null
        }
        Insert: {
          actor_id?: string | null
          amount: number
          created_at?: string
          currency?: string
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          id?: string
          idempotency_key: string
          metadata?: Json
          payment_intent_id?: string | null
          reason?: string | null
          ride_id?: string | null
          source?: string
          wallet_id: string
          withdrawal_id?: string | null
        }
        Update: {
          actor_id?: string | null
          amount?: number
          created_at?: string
          currency?: string
          entry_type?: Database["public"]["Enums"]["ledger_entry_type"]
          id?: string
          idempotency_key?: string
          metadata?: Json
          payment_intent_id?: string | null
          reason?: string | null
          ride_id?: string | null
          source?: string
          wallet_id?: string
          withdrawal_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wallet_ledger_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: false
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wallet_ledger_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      wallets: {
        Row: {
          cached_balance: number
          created_at: string
          currency: string
          driver_id: string | null
          fleet_id: string | null
          held_amount: number
          id: string
          owner_kind: string
          updated_at: string
        }
        Insert: {
          cached_balance?: number
          created_at?: string
          currency?: string
          driver_id?: string | null
          fleet_id?: string | null
          held_amount?: number
          id?: string
          owner_kind: string
          updated_at?: string
        }
        Update: {
          cached_balance?: number
          created_at?: string
          currency?: string
          driver_id?: string | null
          fleet_id?: string | null
          held_amount?: number
          id?: string
          owner_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallets_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawal_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: string
          note: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          withdrawal_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          withdrawal_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          withdrawal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawal_events_withdrawal_id_fkey"
            columns: ["withdrawal_id"]
            isOneToOne: false
            referencedRelation: "withdrawals"
            referencedColumns: ["id"]
          },
        ]
      }
      withdrawals: {
        Row: {
          amount: number
          created_at: string
          destination: string | null
          fee: number
          id: string
          idempotency_key: string
          provider_reference: string | null
          requested_by: string
          review_note: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["withdrawal_status"]
          updated_at: string
          wallet_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          destination?: string | null
          fee?: number
          id?: string
          idempotency_key: string
          provider_reference?: string | null
          requested_by: string
          review_note?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          wallet_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          destination?: string | null
          fee?: number
          id?: string
          idempotency_key?: string
          provider_reference?: string | null
          requested_by?: string
          review_note?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["withdrawal_status"]
          updated_at?: string
          wallet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "withdrawals_wallet_id_fkey"
            columns: ["wallet_id"]
            isOneToOne: false
            referencedRelation: "wallets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_ride_offer: {
        Args: {
          _driver_id: string
          _grace_seconds: number
          _ride_id: string
          _vehicle_id: string
        }
        Returns: {
          assigned_at: string | null
          assignment_expires_at: string | null
          cancellation_fee: number
          cancellation_policy_snapshot: Json
          cancellation_reason: string | null
          cancelled_by: string | null
          commission_amount: number
          commission_percent: number
          completed_at: string | null
          customer_id: string
          driver_id: string | null
          fare_snapshot: Json
          fleet_id: string | null
          id: string
          idempotency_key: string
          ledger_posted_at: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          payment_status: Database["public"]["Enums"]["payment_status"]
          quote_id: string
          reference: string
          requested_at: string
          settlement_snapshot: Json
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          total_fare: number
          updated_at: string
          vehicle_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "rides"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      available_balance: { Args: { _wallet_id: string }; Returns: number }
      can_view_ride: {
        Args: { _ride_id: string; _user_id: string }
        Returns: boolean
      }
      ensure_driver_wallet: { Args: { _driver_id: string }; Returns: string }
      ensure_fleet_wallet: { Args: { _fleet_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      in_fleet: {
        Args: { _fleet_id: string; _user_id: string }
        Returns: boolean
      }
      is_staff: { Args: { _user_id: string }; Returns: boolean }
      may_drive_vehicle: {
        Args: { _user_id: string; _vehicle_id: string }
        Returns: boolean
      }
      owns_fleet: {
        Args: { _fleet_id: string; _user_id: string }
        Returns: boolean
      }
      owns_vehicle: {
        Args: { _user_id: string; _vehicle_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "customer"
        | "driver"
        | "fleet_owner"
        | "ops_admin"
        | "finance_admin"
        | "super_admin"
      approval_state: "pending" | "approved" | "rejected" | "restricted"
      ledger_entry_type:
        | "ride_earning"
        | "platform_commission"
        | "cash_commission_debit"
        | "top_up"
        | "withdrawal_hold"
        | "withdrawal_success"
        | "withdrawal_reversal"
        | "refund"
        | "bonus"
        | "penalty"
        | "manual_adjustment"
      payment_method: "stk_push" | "cash"
      payment_status:
        | "not_required"
        | "pending"
        | "initiating"
        | "awaiting_confirmation"
        | "processing"
        | "paid"
        | "failed"
        | "cancelled"
        | "timed_out"
        | "refund_pending"
        | "refunded"
      policy_state: "draft" | "scheduled" | "published" | "paused" | "archived"
      ride_status:
        | "quote_accepted"
        | "searching"
        | "no_driver_found"
        | "driver_assigned"
        | "driver_arriving"
        | "driver_arrived"
        | "trip_started"
        | "trip_completed"
        | "cancelled_by_customer"
        | "cancelled_by_driver"
        | "cancelled_by_system"
        | "expired"
      vehicle_class: "boda" | "economy" | "comfort" | "xl"
      withdrawal_status:
        | "pending"
        | "under_review"
        | "approved"
        | "processing"
        | "paid"
        | "failed"
        | "reversed"
        | "rejected"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "customer",
        "driver",
        "fleet_owner",
        "ops_admin",
        "finance_admin",
        "super_admin",
      ],
      approval_state: ["pending", "approved", "rejected", "restricted"],
      ledger_entry_type: [
        "ride_earning",
        "platform_commission",
        "cash_commission_debit",
        "top_up",
        "withdrawal_hold",
        "withdrawal_success",
        "withdrawal_reversal",
        "refund",
        "bonus",
        "penalty",
        "manual_adjustment",
      ],
      payment_method: ["stk_push", "cash"],
      payment_status: [
        "not_required",
        "pending",
        "initiating",
        "awaiting_confirmation",
        "processing",
        "paid",
        "failed",
        "cancelled",
        "timed_out",
        "refund_pending",
        "refunded",
      ],
      policy_state: ["draft", "scheduled", "published", "paused", "archived"],
      ride_status: [
        "quote_accepted",
        "searching",
        "no_driver_found",
        "driver_assigned",
        "driver_arriving",
        "driver_arrived",
        "trip_started",
        "trip_completed",
        "cancelled_by_customer",
        "cancelled_by_driver",
        "cancelled_by_system",
        "expired",
      ],
      vehicle_class: ["boda", "economy", "comfort", "xl"],
      withdrawal_status: [
        "pending",
        "under_review",
        "approved",
        "processing",
        "paid",
        "failed",
        "reversed",
        "rejected",
      ],
    },
  },
} as const
