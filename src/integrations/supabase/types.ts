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
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      agreement_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json
          hire_quote_id: string
          id: string
          ip: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          hire_quote_id: string
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json
          hire_quote_id?: string
          id?: string
          ip?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
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
      business_email_otps: {
        Row: {
          attempts: number
          code_hash: string
          created_at: string
          email: string
          expires_at: string
          id: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          created_at?: string
          email: string
          expires_at: string
          id?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      business_kyc_documents: {
        Row: {
          created_at: string
          document_kind: string
          file_path: string
          id: string
          saved_for_future: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          document_kind: string
          file_path: string
          id?: string
          saved_for_future?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          document_kind?: string
          file_path?: string
          id?: string
          saved_for_future?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      business_kyc_edits: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          field: string | null
          id: string
          new_value: string | null
          old_value: string | null
          user_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          field?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_kyc_edits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
      customer_wallet_entries: {
        Row: {
          amount: number
          created_at: string
          funding_batch_id: string | null
          hire_quote_id: string | null
          id: string
          idempotency_key: string
          kind: string
          note: string | null
          payout_phone: string | null
          payout_reference: string | null
          refundable: boolean
          reviewed_by: string | null
          ride_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          funding_batch_id?: string | null
          hire_quote_id?: string | null
          id?: string
          idempotency_key: string
          kind: string
          note?: string | null
          payout_phone?: string | null
          payout_reference?: string | null
          refundable?: boolean
          reviewed_by?: string | null
          ride_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          funding_batch_id?: string | null
          hire_quote_id?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          note?: string | null
          payout_phone?: string | null
          payout_reference?: string | null
          refundable?: boolean
          reviewed_by?: string | null
          ride_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customer_wallet_pins: {
        Row: {
          failed_attempts: number
          locked_until: string | null
          pin_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          failed_attempts?: number
          locked_until?: string | null
          pin_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          failed_attempts?: number
          locked_until?: string | null
          pin_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
      document_branding: {
        Row: {
          accent_color: string
          address: string | null
          agreement_extra_terms: string | null
          agreement_footer: string | null
          company_name: string
          email: string | null
          extra_logos: Json
          key: string
          kra_pin: string | null
          logo_data_url: string | null
          phone: string | null
          receipt_footer: string | null
          tagline: string | null
          updated_at: string
          updated_by: string | null
          website: string | null
        }
        Insert: {
          accent_color?: string
          address?: string | null
          agreement_extra_terms?: string | null
          agreement_footer?: string | null
          company_name?: string
          email?: string | null
          extra_logos?: Json
          key?: string
          kra_pin?: string | null
          logo_data_url?: string | null
          phone?: string | null
          receipt_footer?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Update: {
          accent_color?: string
          address?: string | null
          agreement_extra_terms?: string | null
          agreement_footer?: string | null
          company_name?: string
          email?: string | null
          extra_logos?: Json
          key?: string
          kra_pin?: string | null
          logo_data_url?: string | null
          phone?: string | null
          receipt_footer?: string | null
          tagline?: string | null
          updated_at?: string
          updated_by?: string | null
          website?: string | null
        }
        Relationships: []
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
          expiry_reminders_sent: string[]
          file_path: string | null
          id: string
          insurance_cover_type: string | null
          insurance_coverage_details: string | null
          insurance_policy_number: string | null
          insurance_provider: string | null
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
          expiry_reminders_sent?: string[]
          file_path?: string | null
          id?: string
          insurance_cover_type?: string | null
          insurance_coverage_details?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
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
          expiry_reminders_sent?: string[]
          file_path?: string | null
          id?: string
          insurance_cover_type?: string | null
          insurance_coverage_details?: string | null
          insurance_policy_number?: string | null
          insurance_provider?: string | null
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
      driver_agreement_acceptances: {
        Row: {
          accepted_at: string
          agreement_version: string
          id: string
          ip: string | null
          signer_name: string | null
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted_at?: string
          agreement_version: string
          id?: string
          ip?: string | null
          signer_name?: string | null
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted_at?: string
          agreement_version?: string
          id?: string
          ip?: string | null
          signer_name?: string | null
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
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
      etr_requests: {
        Row: {
          billing_email: string | null
          company_name: string
          created_at: string
          file_path: string | null
          id: string
          kra_pin: string
          requester_id: string
          ride_id: string
          status: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          billing_email?: string | null
          company_name: string
          created_at?: string
          file_path?: string | null
          id?: string
          kra_pin: string
          requester_id: string
          ride_id: string
          status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          billing_email?: string | null
          company_name?: string
          created_at?: string
          file_path?: string | null
          id?: string
          kra_pin?: string
          requester_id?: string
          ride_id?: string
          status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
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
      fleet_delivery_rate_proposals: {
        Row: {
          base_fee: number
          created_at: string
          fleet_id: string
          id: string
          minimum_fee: number
          per_km: number
          per_minute: number
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          submitted_at: string
          submitted_by: string
          updated_at: string
        }
        Insert: {
          base_fee: number
          created_at?: string
          fleet_id: string
          id?: string
          minimum_fee: number
          per_km: number
          per_minute: number
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          submitted_by: string
          updated_at?: string
        }
        Update: {
          base_fee?: number
          created_at?: string
          fleet_id?: string
          id?: string
          minimum_fee?: number
          per_km?: number
          per_minute?: number
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          submitted_at?: string
          submitted_by?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fleet_delivery_rate_proposals_fleet_id_fkey"
            columns: ["fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
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
          delivery_base_fee: number | null
          delivery_business_name: string | null
          delivery_enabled: boolean
          delivery_minimum_fee: number | null
          delivery_per_km: number | null
          delivery_per_minute: number | null
          delivery_rate_status: string
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
          delivery_base_fee?: number | null
          delivery_business_name?: string | null
          delivery_enabled?: boolean
          delivery_minimum_fee?: number | null
          delivery_per_km?: number | null
          delivery_per_minute?: number | null
          delivery_rate_status?: string
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
          delivery_base_fee?: number | null
          delivery_business_name?: string | null
          delivery_enabled?: boolean
          delivery_minimum_fee?: number | null
          delivery_per_km?: number | null
          delivery_per_minute?: number | null
          delivery_rate_status?: string
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
      hire_customer_documents: {
        Row: {
          created_at: string
          document_kind: string
          file_path: string
          id: string
          requester_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          document_kind: string
          file_path: string
          id?: string
          requester_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          document_kind?: string
          file_path?: string
          id?: string
          requester_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      hire_etr_requests: {
        Row: {
          billing_email: string | null
          company_name: string
          created_at: string
          file_path: string | null
          hire_quote_id: string
          id: string
          kra_pin: string
          requester_id: string
          status: string
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          billing_email?: string | null
          company_name: string
          created_at?: string
          file_path?: string | null
          hire_quote_id: string
          id?: string
          kra_pin: string
          requester_id: string
          status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          billing_email?: string | null
          company_name?: string
          created_at?: string
          file_path?: string | null
          hire_quote_id?: string
          id?: string
          kra_pin?: string
          requester_id?: string
          status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      hire_marketing_generations: {
        Row: {
          created_at: string
          id: string
          owner_user_id: string
          period_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          owner_user_id: string
          period_key: string
        }
        Update: {
          created_at?: string
          id?: string
          owner_user_id?: string
          period_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "hire_marketing_generations_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hire_offers: {
        Row: {
          counter_note: string | null
          counter_price: number | null
          created_at: string
          id: string
          note: string | null
          price: number
          quote_id: string
          responder_id: string
          status: string
          updated_at: string
          vehicle_id: string | null
        }
        Insert: {
          counter_note?: string | null
          counter_price?: number | null
          created_at?: string
          id?: string
          note?: string | null
          price: number
          quote_id: string
          responder_id: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Update: {
          counter_note?: string | null
          counter_price?: number | null
          created_at?: string
          id?: string
          note?: string | null
          price?: number
          quote_id?: string
          responder_id?: string
          status?: string
          updated_at?: string
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hire_offers_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "hire_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hire_offers_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      hire_owner_balances: {
        Row: {
          gross_paid_total: number
          owner_balance: number
          owner_user_id: string
          paid_out_total: number
          platform_fee_total: number
          updated_at: string
        }
        Insert: {
          gross_paid_total?: number
          owner_balance?: number
          owner_user_id: string
          paid_out_total?: number
          platform_fee_total?: number
          updated_at?: string
        }
        Update: {
          gross_paid_total?: number
          owner_balance?: number
          owner_user_id?: string
          paid_out_total?: number
          platform_fee_total?: number
          updated_at?: string
        }
        Relationships: []
      }
      hire_owner_brands: {
        Row: {
          accent_color: string
          brand_name: string
          business_info: string
          cover_image_data_url: string | null
          created_at: string
          id: string
          logo_data_url: string | null
          marketing_content: string
          marketing_posts: Json
          owner_bio: string
          owner_user_id: string
          profile_type: string
          slug: string
          updated_at: string
        }
        Insert: {
          accent_color?: string
          brand_name: string
          business_info?: string
          cover_image_data_url?: string | null
          created_at?: string
          id?: string
          logo_data_url?: string | null
          marketing_content?: string
          marketing_posts?: Json
          owner_bio?: string
          owner_user_id: string
          profile_type?: string
          slug: string
          updated_at?: string
        }
        Update: {
          accent_color?: string
          brand_name?: string
          business_info?: string
          cover_image_data_url?: string | null
          created_at?: string
          id?: string
          logo_data_url?: string | null
          marketing_content?: string
          marketing_posts?: Json
          owner_bio?: string
          owner_user_id?: string
          profile_type?: string
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hire_owner_brands_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hire_owner_promotions: {
        Row: {
          created_at: string
          description: string
          discount_percent: number
          expires_at: string | null
          id: string
          merchandise: string | null
          owner_user_id: string
          reward_points: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          discount_percent?: number
          expires_at?: string | null
          id?: string
          merchandise?: string | null
          owner_user_id: string
          reward_points?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          discount_percent?: number
          expires_at?: string | null
          id?: string
          merchandise?: string | null
          owner_user_id?: string
          reward_points?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hire_owner_promotions_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hire_owner_trusted_brands: {
        Row: {
          admin_note: string | null
          brand_name: string
          created_at: string
          id: string
          owner_user_id: string
          permission_confirmed: boolean
          status: string
          updated_at: string
        }
        Insert: {
          admin_note?: string | null
          brand_name: string
          created_at?: string
          id?: string
          owner_user_id: string
          permission_confirmed?: boolean
          status?: string
          updated_at?: string
        }
        Update: {
          admin_note?: string | null
          brand_name?: string
          created_at?: string
          id?: string
          owner_user_id?: string
          permission_confirmed?: boolean
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "hire_owner_trusted_brands_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      hire_payment_settlements: {
        Row: {
          commission_percent: number
          created_at: string
          currency: string
          gross_amount: number
          hire_quote_id: string
          id: string
          mpesa_receipt: string | null
          owner_net_amount: number
          owner_user_id: string
          payment_intent_id: string
          platform_fee_amount: number
        }
        Insert: {
          commission_percent: number
          created_at?: string
          currency?: string
          gross_amount: number
          hire_quote_id: string
          id?: string
          mpesa_receipt?: string | null
          owner_net_amount: number
          owner_user_id: string
          payment_intent_id: string
          platform_fee_amount: number
        }
        Update: {
          commission_percent?: number
          created_at?: string
          currency?: string
          gross_amount?: number
          hire_quote_id?: string
          id?: string
          mpesa_receipt?: string | null
          owner_net_amount?: number
          owner_user_id?: string
          payment_intent_id?: string
          platform_fee_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "hire_payment_settlements_hire_quote_id_fkey"
            columns: ["hire_quote_id"]
            isOneToOne: false
            referencedRelation: "hire_quotes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hire_payment_settlements_payment_intent_id_fkey"
            columns: ["payment_intent_id"]
            isOneToOne: true
            referencedRelation: "payment_intents"
            referencedColumns: ["id"]
          },
        ]
      }
      hire_payout_requests: {
        Row: {
          amount: number
          created_at: string
          id: string
          owner_user_id: string
          paid_at: string | null
          payout_phone: string
          payout_reference: string | null
          requested_at: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          owner_user_id: string
          paid_at?: string | null
          payout_phone: string
          payout_reference?: string | null
          requested_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          owner_user_id?: string
          paid_at?: string | null
          payout_phone?: string
          payout_reference?: string | null
          requested_at?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      hire_quotes: {
        Row: {
          accepted_offer_id: string | null
          admin_notes: string | null
          agreement_completed_at: string | null
          agreement_emailed_at: string | null
          agreement_signature: string | null
          agreement_signed_at: string | null
          agreement_signer_name: string | null
          assigned_driver_id: string | null
          business_address: string | null
          business_email: string | null
          business_email_verified_at: string | null
          business_registration_number: string | null
          commission_percent_snapshot: number | null
          company_verified_at: string | null
          company_verified_by: string | null
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          created_at: string
          currency: string
          days: number
          deposit_amount: number
          deposit_policy: string
          deposit_requested_at: string | null
          drive_mode: string
          duration_hours: number | null
          end_at: string | null
          estimated_total: number
          handed_over_at: string | null
          hirer_inspection: Json | null
          hirer_type: string
          id: string
          id_document_path: string | null
          inspection_at: string | null
          inspection_fuel: string | null
          inspection_notes: string | null
          inspection_odometer: number | null
          inspection_photos: Json
          kind: string
          license_document_path: string | null
          notes: string | null
          organisation: string | null
          owner_decline_reason: string | null
          owner_declined_at: string | null
          owner_signature: string | null
          owner_signed_at: string | null
          owner_signed_by: string | null
          owner_signer_name: string | null
          passengers: number
          pay_later_due_date: string | null
          pay_later_method: string | null
          payment_hold_expires_at: string | null
          payment_minimum_amount: number | null
          payment_paid_total: number
          payment_policy: string
          payment_status: string
          pickup_label: string | null
          pickup_lat: number | null
          pickup_lng: number | null
          quoted_total: number | null
          reference: string
          renter_id_number: string | null
          renter_name: string | null
          requester_id: string
          return_balance_due: number | null
          return_deposit_held: number | null
          return_deposit_kept: number | null
          return_deposit_returned: number | null
          return_excess_km_charge: number | null
          return_excess_km_waived: boolean
          return_fuel_charge: number | null
          return_fuel_level: string | null
          return_fuel_missing_percent: number | null
          return_fuel_waived: boolean
          return_km_driven: number | null
          return_notes: string | null
          return_odometer: number | null
          return_penalties: number | null
          returned_at: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rules_accepted_at: string | null
          service_type: string
          start_at: string
          status: string
          stops: Json
          updated_at: string
          vehicle_class: Database["public"]["Enums"]["vehicle_class"]
          vehicle_id: string | null
        }
        Insert: {
          accepted_offer_id?: string | null
          admin_notes?: string | null
          agreement_completed_at?: string | null
          agreement_emailed_at?: string | null
          agreement_signature?: string | null
          agreement_signed_at?: string | null
          agreement_signer_name?: string | null
          assigned_driver_id?: string | null
          business_address?: string | null
          business_email?: string | null
          business_email_verified_at?: string | null
          business_registration_number?: string | null
          commission_percent_snapshot?: number | null
          company_verified_at?: string | null
          company_verified_by?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          days?: number
          deposit_amount?: number
          deposit_policy?: string
          deposit_requested_at?: string | null
          drive_mode?: string
          duration_hours?: number | null
          end_at?: string | null
          estimated_total?: number
          handed_over_at?: string | null
          hirer_inspection?: Json | null
          hirer_type?: string
          id?: string
          id_document_path?: string | null
          inspection_at?: string | null
          inspection_fuel?: string | null
          inspection_notes?: string | null
          inspection_odometer?: number | null
          inspection_photos?: Json
          kind?: string
          license_document_path?: string | null
          notes?: string | null
          organisation?: string | null
          owner_decline_reason?: string | null
          owner_declined_at?: string | null
          owner_signature?: string | null
          owner_signed_at?: string | null
          owner_signed_by?: string | null
          owner_signer_name?: string | null
          passengers?: number
          pay_later_due_date?: string | null
          pay_later_method?: string | null
          payment_hold_expires_at?: string | null
          payment_minimum_amount?: number | null
          payment_paid_total?: number
          payment_policy?: string
          payment_status?: string
          pickup_label?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          quoted_total?: number | null
          reference?: string
          renter_id_number?: string | null
          renter_name?: string | null
          requester_id: string
          return_balance_due?: number | null
          return_deposit_held?: number | null
          return_deposit_kept?: number | null
          return_deposit_returned?: number | null
          return_excess_km_charge?: number | null
          return_excess_km_waived?: boolean
          return_fuel_charge?: number | null
          return_fuel_level?: string | null
          return_fuel_missing_percent?: number | null
          return_fuel_waived?: boolean
          return_km_driven?: number | null
          return_notes?: string | null
          return_odometer?: number | null
          return_penalties?: number | null
          returned_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rules_accepted_at?: string | null
          service_type?: string
          start_at: string
          status?: string
          stops?: Json
          updated_at?: string
          vehicle_class: Database["public"]["Enums"]["vehicle_class"]
          vehicle_id?: string | null
        }
        Update: {
          accepted_offer_id?: string | null
          admin_notes?: string | null
          agreement_completed_at?: string | null
          agreement_emailed_at?: string | null
          agreement_signature?: string | null
          agreement_signed_at?: string | null
          agreement_signer_name?: string | null
          assigned_driver_id?: string | null
          business_address?: string | null
          business_email?: string | null
          business_email_verified_at?: string | null
          business_registration_number?: string | null
          commission_percent_snapshot?: number | null
          company_verified_at?: string | null
          company_verified_by?: string | null
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          created_at?: string
          currency?: string
          days?: number
          deposit_amount?: number
          deposit_policy?: string
          deposit_requested_at?: string | null
          drive_mode?: string
          duration_hours?: number | null
          end_at?: string | null
          estimated_total?: number
          handed_over_at?: string | null
          hirer_inspection?: Json | null
          hirer_type?: string
          id?: string
          id_document_path?: string | null
          inspection_at?: string | null
          inspection_fuel?: string | null
          inspection_notes?: string | null
          inspection_odometer?: number | null
          inspection_photos?: Json
          kind?: string
          license_document_path?: string | null
          notes?: string | null
          organisation?: string | null
          owner_decline_reason?: string | null
          owner_declined_at?: string | null
          owner_signature?: string | null
          owner_signed_at?: string | null
          owner_signed_by?: string | null
          owner_signer_name?: string | null
          passengers?: number
          pay_later_due_date?: string | null
          pay_later_method?: string | null
          payment_hold_expires_at?: string | null
          payment_minimum_amount?: number | null
          payment_paid_total?: number
          payment_policy?: string
          payment_status?: string
          pickup_label?: string | null
          pickup_lat?: number | null
          pickup_lng?: number | null
          quoted_total?: number | null
          reference?: string
          renter_id_number?: string | null
          renter_name?: string | null
          requester_id?: string
          return_balance_due?: number | null
          return_deposit_held?: number | null
          return_deposit_kept?: number | null
          return_deposit_returned?: number | null
          return_excess_km_charge?: number | null
          return_excess_km_waived?: boolean
          return_fuel_charge?: number | null
          return_fuel_level?: string | null
          return_fuel_missing_percent?: number | null
          return_fuel_waived?: boolean
          return_km_driven?: number | null
          return_notes?: string | null
          return_odometer?: number | null
          return_penalties?: number | null
          returned_at?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rules_accepted_at?: string | null
          service_type?: string
          start_at?: string
          status?: string
          stops?: Json
          updated_at?: string
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
          vehicle_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hire_quotes_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
      }
      hire_vehicle_blackouts: {
        Row: {
          created_at: string
          end_date: string
          id: string
          note: string
          owner_user_id: string
          start_date: string
          vehicle_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          note?: string
          owner_user_id: string
          start_date: string
          vehicle_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          note?: string
          owner_user_id?: string
          start_date?: string
          vehicle_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hire_vehicle_blackouts_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "hire_vehicle_blackouts_vehicle_id_fkey"
            columns: ["vehicle_id"]
            isOneToOne: false
            referencedRelation: "vehicles"
            referencedColumns: ["id"]
          },
        ]
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
      lost_found_claims: {
        Row: {
          claimant_id: string
          contact_phone: string | null
          created_at: string
          customer_confirmed_at: string | null
          description: string
          driver_note: string | null
          dropoff_note: string | null
          handover_request: string | null
          id: string
          phone_shared_at: string | null
          report_id: string
          ride_id: string
          security_details: string | null
          status: string
          updated_at: string
        }
        Insert: {
          claimant_id: string
          contact_phone?: string | null
          created_at?: string
          customer_confirmed_at?: string | null
          description: string
          driver_note?: string | null
          dropoff_note?: string | null
          handover_request?: string | null
          id?: string
          phone_shared_at?: string | null
          report_id: string
          ride_id: string
          security_details?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          claimant_id?: string
          contact_phone?: string | null
          created_at?: string
          customer_confirmed_at?: string | null
          description?: string
          driver_note?: string | null
          dropoff_note?: string | null
          handover_request?: string | null
          id?: string
          phone_shared_at?: string | null
          report_id?: string
          ride_id?: string
          security_details?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lost_found_claims_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "lost_found_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      lost_found_reports: {
        Row: {
          created_at: string
          description: string
          id: string
          kind: string
          photo_path: string | null
          reporter_id: string
          reporter_role: string
          ride_ids: string[]
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          kind: string
          photo_path?: string | null
          reporter_id: string
          reporter_role: string
          ride_ids?: string[]
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          kind?: string
          photo_path?: string | null
          reporter_id?: string
          reporter_role?: string
          ride_ids?: string[]
          status?: string
          updated_at?: string
        }
        Relationships: []
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
          whatsapp_enabled: boolean
          whatsapp_opt_in_source: string | null
          whatsapp_opted_in_at: string | null
        }
        Insert: {
          email_enabled?: boolean
          push_enabled?: boolean
          push_permission?: string
          sms_enabled?: boolean
          updated_at?: string
          user_id: string
          whatsapp_enabled?: boolean
          whatsapp_opt_in_source?: string | null
          whatsapp_opted_in_at?: string | null
        }
        Update: {
          email_enabled?: boolean
          push_enabled?: boolean
          push_permission?: string
          sms_enabled?: boolean
          updated_at?: string
          user_id?: string
          whatsapp_enabled?: boolean
          whatsapp_opt_in_source?: string | null
          whatsapp_opted_in_at?: string | null
        }
        Relationships: []
      }
      owner_signatures: {
        Row: {
          auto_sign: boolean
          signature: string
          signer_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_sign?: boolean
          signature: string
          signer_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_sign?: boolean
          signature?: string
          signer_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      partner_interest_requests: {
        Row: {
          best_time: string
          created_at: string
          full_name: string
          id: string
          licence_psv_status: string | null
          note: string | null
          number_of_cars: number | null
          owns_vehicle: boolean | null
          phone: string
          preferred_work_type: string | null
          request_type: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          town: string
          updated_at: string
          whatsapp_opt_in: boolean
        }
        Insert: {
          best_time: string
          created_at?: string
          full_name: string
          id?: string
          licence_psv_status?: string | null
          note?: string | null
          number_of_cars?: number | null
          owns_vehicle?: boolean | null
          phone: string
          preferred_work_type?: string | null
          request_type: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          town: string
          updated_at?: string
          whatsapp_opt_in?: boolean
        }
        Update: {
          best_time?: string
          created_at?: string
          full_name?: string
          id?: string
          licence_psv_status?: string | null
          note?: string | null
          number_of_cars?: number | null
          owns_vehicle?: boolean | null
          phone?: string
          preferred_work_type?: string | null
          request_type?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          town?: string
          updated_at?: string
          whatsapp_opt_in?: boolean
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
          hire_quote_id: string | null
          id: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          mode: string
          msisdn: string | null
          provider: string
          provider_reference: string | null
          provider_request: Json
          provider_response: Json
          ride_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          customer_id: string
          failure_reason?: string | null
          hire_quote_id?: string | null
          id?: string
          idempotency_key: string
          method: Database["public"]["Enums"]["payment_method"]
          mode?: string
          msisdn?: string | null
          provider?: string
          provider_reference?: string | null
          provider_request?: Json
          provider_response?: Json
          ride_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          customer_id?: string
          failure_reason?: string | null
          hire_quote_id?: string | null
          id?: string
          idempotency_key?: string
          method?: Database["public"]["Enums"]["payment_method"]
          mode?: string
          msisdn?: string | null
          provider?: string
          provider_reference?: string | null
          provider_request?: Json
          provider_response?: Json
          ride_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_intents_hire_quote_id_fkey"
            columns: ["hire_quote_id"]
            isOneToOne: false
            referencedRelation: "hire_quotes"
            referencedColumns: ["id"]
          },
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
          peak_at: string | null
          peak_percent: number | null
          percent: number
          ramp_mode: string
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
          peak_at?: string | null
          peak_percent?: number | null
          percent: number
          ramp_mode?: string
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
          peak_at?: string | null
          peak_percent?: number | null
          percent?: number
          ramp_mode?: string
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
          company_billing_email: string | null
          company_kra_pin: string | null
          company_name: string | null
          company_registration_number: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          id_number: string | null
          locale: string
          password_set_at: string | null
          payment_preference: string
          phone: string | null
          phone_verified_at: string | null
          share_driver_code: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_billing_email?: string | null
          company_kra_pin?: string | null
          company_name?: string | null
          company_registration_number?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          id_number?: string | null
          locale?: string
          password_set_at?: string | null
          payment_preference?: string
          phone?: string | null
          phone_verified_at?: string | null
          share_driver_code?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_billing_email?: string | null
          company_kra_pin?: string | null
          company_name?: string | null
          company_registration_number?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          id_number?: string | null
          locale?: string
          password_set_at?: string | null
          payment_preference?: string
          phone?: string | null
          phone_verified_at?: string | null
          share_driver_code?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      promotion_redemptions: {
        Row: {
          code: string
          created_at: string
          customer_id: string
          discount_amount: number
          id: string
          promotion_id: string
          ride_id: string | null
        }
        Insert: {
          code: string
          created_at?: string
          customer_id: string
          discount_amount?: number
          id?: string
          promotion_id: string
          ride_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          customer_id?: string
          discount_amount?: number
          id?: string
          promotion_id?: string
          ride_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "promotion_redemptions_promotion_id_fkey"
            columns: ["promotion_id"]
            isOneToOne: false
            referencedRelation: "promotions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "promotion_redemptions_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      promotions: {
        Row: {
          active: boolean
          applies_to: string[]
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          discount_percent: number
          id: string
          max_discount_amount: number | null
          max_discount_percent: number
          min_fare: number | null
          name: string
          updated_at: string
          usage_count: number
          usage_limit: number | null
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          applies_to?: string[]
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_percent?: number
          id?: string
          max_discount_amount?: number | null
          max_discount_percent?: number
          min_fare?: number | null
          name: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          applies_to?: string[]
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          discount_percent?: number
          id?: string
          max_discount_amount?: number | null
          max_discount_percent?: number
          min_fare?: number | null
          name?: string
          updated_at?: string
          usage_count?: number
          usage_limit?: number | null
          valid_from?: string
          valid_until?: string | null
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
      push_tokens: {
        Row: {
          created_at: string
          device_label: string | null
          id: string
          last_seen_at: string
          platform: string
          token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_label?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_label?: string | null
          id?: string
          last_seen_at?: string
          platform?: string
          token?: string
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
          queued_after_ride_id: string | null
          quote_id: string
          reference: string
          requested_at: string
          settlement_snapshot: Json
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          total_fare: number
          trip_kind: string
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
          queued_after_ride_id?: string | null
          quote_id: string
          reference?: string
          requested_at?: string
          settlement_snapshot?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          total_fare: number
          trip_kind?: string
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
          queued_after_ride_id?: string | null
          quote_id?: string
          reference?: string
          requested_at?: string
          settlement_snapshot?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["ride_status"]
          total_fare?: number
          trip_kind?: string
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
            foreignKeyName: "rides_queued_after_ride_id_fkey"
            columns: ["queued_after_ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
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
          delivery_fleet_id: string | null
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
          recipient_name: string | null
          recipient_phone: string | null
          route_provider: string
          route_response: Json
          stops: Json
          total_fare: number
          trip_kind: string
          unrounded_total: number
          vehicle_class: Database["public"]["Enums"]["vehicle_class"]
        }
        Insert: {
          accepted_at?: string | null
          breakdown: Json
          created_at?: string
          currency?: string
          customer_id: string
          delivery_fleet_id?: string | null
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
          recipient_name?: string | null
          recipient_phone?: string | null
          route_provider?: string
          route_response?: Json
          stops?: Json
          total_fare: number
          trip_kind?: string
          unrounded_total: number
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
        }
        Update: {
          accepted_at?: string | null
          breakdown?: Json
          created_at?: string
          currency?: string
          customer_id?: string
          delivery_fleet_id?: string | null
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
          recipient_name?: string | null
          recipient_phone?: string | null
          route_provider?: string
          route_response?: Json
          stops?: Json
          total_fare?: number
          trip_kind?: string
          unrounded_total?: number
          vehicle_class?: Database["public"]["Enums"]["vehicle_class"]
        }
        Relationships: [
          {
            foreignKeyName: "route_quotes_delivery_fleet_id_fkey"
            columns: ["delivery_fleet_id"]
            isOneToOne: false
            referencedRelation: "fleets"
            referencedColumns: ["id"]
          },
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
      support_cases: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          customer_id: string
          id: string
          involved_driver_id: string | null
          last_message_at: string
          priority: string
          ride_id: string | null
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          customer_id: string
          id?: string
          involved_driver_id?: string | null
          last_message_at?: string
          priority?: string
          ride_id?: string | null
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          created_at?: string
          customer_id?: string
          id?: string
          involved_driver_id?: string | null
          last_message_at?: string
          priority?: string
          ride_id?: string | null
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_cases_ride_id_fkey"
            columns: ["ride_id"]
            isOneToOne: false
            referencedRelation: "rides"
            referencedColumns: ["id"]
          },
        ]
      }
      support_messages: {
        Row: {
          body: string
          case_id: string
          created_at: string
          id: string
          read_at: string | null
          sender_id: string | null
          sender_role: string
        }
        Insert: {
          body: string
          case_id: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_role?: string
        }
        Update: {
          body?: string
          case_id?: string
          created_at?: string
          id?: string
          read_at?: string | null
          sender_id?: string | null
          sender_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_messages_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "support_cases"
            referencedColumns: ["id"]
          },
        ]
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
      vehicle_interest_requests: {
        Row: {
          admin_response: string | null
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          created_at: string
          id: string
          recommended_vehicle_ids: string[]
          responded_at: string | null
          responded_by: string | null
          status: string
          trip_needs: string
          updated_at: string
        }
        Insert: {
          admin_response?: string | null
          contact_email?: string | null
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          recommended_vehicle_ids?: string[]
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          trip_needs: string
          updated_at?: string
        }
        Update: {
          admin_response?: string | null
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          id?: string
          recommended_vehicle_ids?: string[]
          responded_at?: string | null
          responded_by?: string | null
          status?: string
          trip_needs?: string
          updated_at?: string
        }
        Relationships: []
      }
      vehicles: {
        Row: {
          active_driver_id: string | null
          colour: string | null
          created_at: string
          fleet_id: string | null
          hire_approval_status: string
          hire_available: boolean
          hire_cancellation_policy: string
          hire_chauffeur_daily_rate: number
          hire_daily_rate: number | null
          hire_deposit_amount: number
          hire_deposit_policy: string
          hire_description: string | null
          hire_features: string | null
          hire_hourly_available: boolean
          hire_insurance_details: string | null
          hire_insurance_type: string | null
          hire_minimum_age: number | null
          hire_mode: string
          hire_notes: string | null
          hire_pay_later_allowed: boolean
          hire_payment_policy: string
          hire_rejection_reason: string | null
          hire_reviewed_at: string | null
          hire_reviewed_by: string | null
          hire_rules: string | null
          id: string
          make: string | null
          model: string | null
          owner_driver_id: string | null
          photo_url: string | null
          photo_urls: string[]
          plate_number: string
          seats: number | null
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
          hire_approval_status?: string
          hire_available?: boolean
          hire_cancellation_policy?: string
          hire_chauffeur_daily_rate?: number
          hire_daily_rate?: number | null
          hire_deposit_amount?: number
          hire_deposit_policy?: string
          hire_description?: string | null
          hire_features?: string | null
          hire_hourly_available?: boolean
          hire_insurance_details?: string | null
          hire_insurance_type?: string | null
          hire_minimum_age?: number | null
          hire_mode?: string
          hire_notes?: string | null
          hire_pay_later_allowed?: boolean
          hire_payment_policy?: string
          hire_rejection_reason?: string | null
          hire_reviewed_at?: string | null
          hire_reviewed_by?: string | null
          hire_rules?: string | null
          id?: string
          make?: string | null
          model?: string | null
          owner_driver_id?: string | null
          photo_url?: string | null
          photo_urls?: string[]
          plate_number: string
          seats?: number | null
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
          hire_approval_status?: string
          hire_available?: boolean
          hire_cancellation_policy?: string
          hire_chauffeur_daily_rate?: number
          hire_daily_rate?: number | null
          hire_deposit_amount?: number
          hire_deposit_policy?: string
          hire_description?: string | null
          hire_features?: string | null
          hire_hourly_available?: boolean
          hire_insurance_details?: string | null
          hire_insurance_type?: string | null
          hire_minimum_age?: number | null
          hire_mode?: string
          hire_notes?: string | null
          hire_pay_later_allowed?: boolean
          hire_payment_policy?: string
          hire_rejection_reason?: string | null
          hire_reviewed_at?: string | null
          hire_reviewed_by?: string | null
          hire_rules?: string | null
          id?: string
          make?: string | null
          model?: string | null
          owner_driver_id?: string | null
          photo_url?: string | null
          photo_urls?: string[]
          plate_number?: string
          seats?: number | null
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
      wallet_funding_batches: {
        Row: {
          amount_per_user: number
          approved_at: string | null
          approved_by: string | null
          approver_phone: string
          code_attempts: number
          code_expires_at: string | null
          code_hash: string | null
          cohort: string
          created_at: string
          created_by: string
          id: string
          mpesa_receipt: string | null
          note: string | null
          payment_intent_id: string | null
          status: string
          total_amount: number
          updated_at: string
          user_ids: string[]
        }
        Insert: {
          amount_per_user: number
          approved_at?: string | null
          approved_by?: string | null
          approver_phone: string
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          cohort: string
          created_at?: string
          created_by: string
          id?: string
          mpesa_receipt?: string | null
          note?: string | null
          payment_intent_id?: string | null
          status?: string
          total_amount: number
          updated_at?: string
          user_ids: string[]
        }
        Update: {
          amount_per_user?: number
          approved_at?: string | null
          approved_by?: string | null
          approver_phone?: string
          code_attempts?: number
          code_expires_at?: string | null
          code_hash?: string | null
          cohort?: string
          created_at?: string
          created_by?: string
          id?: string
          mpesa_receipt?: string | null
          note?: string | null
          payment_intent_id?: string | null
          status?: string
          total_amount?: number
          updated_at?: string
          user_ids?: string[]
        }
        Relationships: []
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
      wallet_pin_resets: {
        Row: {
          attempts: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          phone: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          phone: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          phone?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: []
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
      whatsapp_conversations: {
        Row: {
          created_at: string
          customer_name: string | null
          customer_phone: string
          id: string
          last_inbound_at: string | null
          last_message_at: string
          last_message_preview: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_name?: string | null
          customer_phone: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_name?: string | null
          customer_phone?: string
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_messages: {
        Row: {
          attachment_meta: Json
          body: string
          conversation_id: string
          created_at: string
          direction: string
          error_message: string | null
          hire_quote_id: string | null
          id: string
          idempotency_key: string | null
          message_type: string
          provider_message_id: string | null
          sent_by: string | null
          status: string
        }
        Insert: {
          attachment_meta?: Json
          body: string
          conversation_id: string
          created_at?: string
          direction: string
          error_message?: string | null
          hire_quote_id?: string | null
          id?: string
          idempotency_key?: string | null
          message_type?: string
          provider_message_id?: string | null
          sent_by?: string | null
          status?: string
        }
        Update: {
          attachment_meta?: Json
          body?: string
          conversation_id?: string
          created_at?: string
          direction?: string
          error_message?: string | null
          hire_quote_id?: string | null
          id?: string
          idempotency_key?: string | null
          message_type?: string
          provider_message_id?: string | null
          sent_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_hire_quote_id_fkey"
            columns: ["hire_quote_id"]
            isOneToOne: false
            referencedRelation: "hire_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_events: {
        Row: {
          attempts: number
          delivery_id: string
          event: string
          id: string
          payload: Json
          processed_at: string | null
          processing_error: string | null
          received_at: string
        }
        Insert: {
          attempts?: number
          delivery_id: string
          event: string
          id?: string
          payload: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
        }
        Update: {
          attempts?: number
          delivery_id?: string
          event?: string
          id?: string
          payload?: Json
          processed_at?: string | null
          processing_error?: string | null
          received_at?: string
        }
        Relationships: []
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
          queued_after_ride_id: string | null
          quote_id: string
          reference: string
          requested_at: string
          settlement_snapshot: Json
          started_at: string | null
          status: Database["public"]["Enums"]["ride_status"]
          total_fare: number
          trip_kind: string
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
      apply_hire_payment: {
        Args: { p_mpesa_receipt?: string; p_payment_intent_id: string }
        Returns: Json
      }
      available_balance: { Args: { _wallet_id: string }; Returns: number }
      can_view_ride: {
        Args: { _ride_id: string; _user_id: string }
        Returns: boolean
      }
      customer_wallet_move: {
        Args: {
          p_amount: number
          p_batch_id?: string
          p_hire_quote_id?: string
          p_key: string
          p_kind: string
          p_note: string
          p_phone?: string
          p_refundable?: boolean
          p_ride_id: string
          p_status: string
          p_user_id: string
        }
        Returns: Json
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
      increment_whatsapp_unread: {
        Args: { _conversation_id: string }
        Returns: undefined
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
      request_hire_payout: {
        Args: {
          p_amount: number
          p_owner_user_id: string
          p_payout_phone: string
        }
        Returns: Json
      }
      requires_phone_verification: { Args: never; Returns: boolean }
      review_delivery_rate_proposal: {
        Args: {
          p_decision: string
          p_note?: string
          p_proposal_id: string
          p_reviewer_id: string
        }
        Returns: undefined
      }
      review_hire_payout_request: {
        Args: {
          p_decision: string
          p_note?: string
          p_payout_reference?: string
          p_request_id: string
          p_reviewer_id: string
        }
        Returns: Json
      }
      vehicle_has_active_hire: {
        Args: { _at?: string; _vehicle_id: string }
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
      vehicle_class: "boda" | "go" | "comfort" | "xl" | "plus" | "e_boda"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      vehicle_class: ["boda", "go", "comfort", "xl", "plus", "e_boda"],
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
