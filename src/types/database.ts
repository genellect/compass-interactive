export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      academic_answer_publication_events: {
        Row: {
          actor_id: string | null
          answer_id: string
          created_at: string
          event_type: string
          id: string
          lecture_session_id: string
          next_visibility: string
          previous_visibility: string | null
          reason: string | null
          revision_id: string
        }
        Insert: {
          actor_id?: string | null
          answer_id: string
          created_at?: string
          event_type: string
          id?: string
          lecture_session_id: string
          next_visibility: string
          previous_visibility?: string | null
          reason?: string | null
          revision_id: string
        }
        Update: {
          actor_id?: string | null
          answer_id?: string
          created_at?: string
          event_type?: string
          id?: string
          lecture_session_id?: string
          next_visibility?: string
          previous_visibility?: string | null
          reason?: string | null
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_answer_publication_e_lecture_session_id_answer_id_fkey"
            columns: ["lecture_session_id", "answer_id", "revision_id"]
            isOneToOne: false
            referencedRelation: "academic_answer_revisions"
            referencedColumns: ["lecture_session_id", "answer_id", "id"]
          },
          {
            foreignKeyName: "academic_answer_publication_events_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "lecture_academic_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_answer_publication_events_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_answer_publications: {
        Row: {
          active_revision_id: string
          answer_id: string
          created_at: string
          lecture_session_id: string
          published_at: string | null
          review_state: string
          reviewed_by_actor_id: string | null
          updated_at: string
          visibility: string
        }
        Insert: {
          active_revision_id: string
          answer_id: string
          created_at?: string
          lecture_session_id: string
          published_at?: string | null
          review_state?: string
          reviewed_by_actor_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Update: {
          active_revision_id?: string
          answer_id?: string
          created_at?: string
          lecture_session_id?: string
          published_at?: string | null
          review_state?: string
          reviewed_by_actor_id?: string | null
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_answer_publications_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: true
            referencedRelation: "lecture_academic_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_answer_publications_lecture_session_id_answer_id__fkey"
            columns: ["lecture_session_id", "answer_id", "active_revision_id"]
            isOneToOne: false
            referencedRelation: "academic_answer_revisions"
            referencedColumns: ["lecture_session_id", "answer_id", "id"]
          },
          {
            foreignKeyName: "academic_answer_publications_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_answer_requests: {
        Row: {
          automation_run_id: string | null
          created_at: string
          error_code: string | null
          evidence_attempt_count: number
          id: string
          idempotency_key: string
          lease_until: string | null
          lecture_session_id: string
          operation_id: string | null
          prompt_version: string | null
          provider_dispatched_at: string | null
          publication_mode: string
          question: string
          question_sha256: string
          requested_by_actor: string
          requested_source_policy: string
          resolved_source_route: string | null
          retrieval_version: string
          search_query_sha256: string
          source_kind: string
          source_set_sha256: string | null
          source_summary_id: string | null
          status: string
          updated_at: string
          verified_primary_count: number
          verified_source_count: number
        }
        Insert: {
          automation_run_id?: string | null
          created_at?: string
          error_code?: string | null
          evidence_attempt_count?: number
          id?: string
          idempotency_key: string
          lease_until?: string | null
          lecture_session_id: string
          operation_id?: string | null
          prompt_version?: string | null
          provider_dispatched_at?: string | null
          publication_mode?: string
          question: string
          question_sha256: string
          requested_by_actor: string
          requested_source_policy?: string
          resolved_source_route?: string | null
          retrieval_version?: string
          search_query_sha256: string
          source_kind: string
          source_set_sha256?: string | null
          source_summary_id?: string | null
          status?: string
          updated_at?: string
          verified_primary_count?: number
          verified_source_count?: number
        }
        Update: {
          automation_run_id?: string | null
          created_at?: string
          error_code?: string | null
          evidence_attempt_count?: number
          id?: string
          idempotency_key?: string
          lease_until?: string | null
          lecture_session_id?: string
          operation_id?: string | null
          prompt_version?: string | null
          provider_dispatched_at?: string | null
          publication_mode?: string
          question?: string
          question_sha256?: string
          requested_by_actor?: string
          requested_source_policy?: string
          resolved_source_route?: string | null
          retrieval_version?: string
          search_query_sha256?: string
          source_kind?: string
          source_set_sha256?: string | null
          source_summary_id?: string | null
          status?: string
          updated_at?: string
          verified_primary_count?: number
          verified_source_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "academic_answer_requests_automation_lecture_fk"
            columns: ["lecture_session_id", "automation_run_id"]
            isOneToOne: false
            referencedRelation: "lecture_summary_runs"
            referencedColumns: ["lecture_session_id", "id"]
          },
          {
            foreignKeyName: "academic_answer_requests_automation_run_id_fkey"
            columns: ["automation_run_id"]
            isOneToOne: false
            referencedRelation: "lecture_summary_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_answer_requests_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_answer_requests_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "ai_usage_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_answer_requests_source_summary_id_fkey"
            columns: ["source_summary_id"]
            isOneToOne: false
            referencedRelation: "lecture_ai_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_answer_revisions: {
        Row: {
          answer_id: string
          author_actor_id: string | null
          author_type: string
          body: Json
          created_at: string
          id: string
          lecture_session_id: string
          reason: string | null
          revision_number: number
        }
        Insert: {
          answer_id: string
          author_actor_id?: string | null
          author_type: string
          body: Json
          created_at?: string
          id?: string
          lecture_session_id: string
          reason?: string | null
          revision_number: number
        }
        Update: {
          answer_id?: string
          author_actor_id?: string | null
          author_type?: string
          body?: Json
          created_at?: string
          id?: string
          lecture_session_id?: string
          reason?: string | null
          revision_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "academic_answer_revisions_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "lecture_academic_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_answer_revisions_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_answer_sources: {
        Row: {
          answer_id: string
          authors: Json
          doi: string | null
          id: string
          journal: string
          lecture_session_id: string
          pmid: string | null
          publication_types: Json
          publication_year: number
          source_id: string
          source_provider: string
          source_role: string
          study_type: string
          title: string
          verification: Json
          verified_at: string
        }
        Insert: {
          answer_id: string
          authors: Json
          doi?: string | null
          id?: string
          journal: string
          lecture_session_id: string
          pmid?: string | null
          publication_types: Json
          publication_year: number
          source_id: string
          source_provider?: string
          source_role: string
          study_type: string
          title: string
          verification: Json
          verified_at?: string
        }
        Update: {
          answer_id?: string
          authors?: Json
          doi?: string | null
          id?: string
          journal?: string
          lecture_session_id?: string
          pmid?: string | null
          publication_types?: Json
          publication_year?: number
          source_id?: string
          source_provider?: string
          source_role?: string
          study_type?: string
          title?: string
          verification?: Json
          verified_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_answer_sources_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "lecture_academic_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "academic_answer_sources_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_pin_rate_limits: {
        Row: {
          attempt_count: number
          blocked_until: string | null
          bucket_hash: string
          bucket_type: string
          last_attempt_at: string
          updated_at: string
          window_started_at: string
        }
        Insert: {
          attempt_count?: number
          blocked_until?: string | null
          bucket_hash: string
          bucket_type: string
          last_attempt_at?: string
          updated_at?: string
          window_started_at?: string
        }
        Update: {
          attempt_count?: number
          blocked_until?: string | null
          bucket_hash?: string
          bucket_type?: string
          last_attempt_at?: string
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      admin_sessions: {
        Row: {
          auth_user_id: string
          created_at: string
          expires_at: string
          id: string
          idle_expires_at: string
          issued_at: string
          last_seen_at: string
          network_hash: string | null
          pin_version_hash: string
          revoke_reason: string | null
          revoked_at: string | null
          token_hash: string
          updated_at: string
          user_agent_hash: string | null
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          expires_at: string
          id: string
          idle_expires_at: string
          issued_at?: string
          last_seen_at?: string
          network_hash?: string | null
          pin_version_hash: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash: string
          updated_at?: string
          user_agent_hash?: string | null
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          expires_at?: string
          id?: string
          idle_expires_at?: string
          issued_at?: string
          last_seen_at?: string
          network_hash?: string | null
          pin_version_hash?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_hash?: string
          updated_at?: string
          user_agent_hash?: string | null
        }
        Relationships: []
      }
      ai_billing_grants: {
        Row: {
          actions: string[]
          actor_id: string
          consumed_at: string | null
          expires_at: string
          id: string
          issued_at: string
          lecture_session_id: string
          master_authorization_id: string | null
          nonce_hash: string
          operation_ids: string[]
          revoked_at: string | null
          status: string
        }
        Insert: {
          actions: string[]
          actor_id: string
          consumed_at?: string | null
          expires_at: string
          id?: string
          issued_at?: string
          lecture_session_id: string
          master_authorization_id?: string | null
          nonce_hash: string
          operation_ids?: string[]
          revoked_at?: string | null
          status?: string
        }
        Update: {
          actions?: string[]
          actor_id?: string
          consumed_at?: string | null
          expires_at?: string
          id?: string
          issued_at?: string
          lecture_session_id?: string
          master_authorization_id?: string | null
          nonce_hash?: string
          operation_ids?: string[]
          revoked_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_billing_grants_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_billing_grants_master_authorization_id_fkey"
            columns: ["master_authorization_id"]
            isOneToOne: false
            referencedRelation: "lecture_ai_master_authorizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_billing_rate_limits: {
        Row: {
          failed_attempts: number
          last_failed_at: string | null
          lecture_session_id: string
          locked_until: string | null
          updated_at: string
          window_started_at: string | null
        }
        Insert: {
          failed_attempts?: number
          last_failed_at?: string | null
          lecture_session_id: string
          locked_until?: string | null
          updated_at?: string
          window_started_at?: string | null
        }
        Update: {
          failed_attempts?: number
          last_failed_at?: string | null
          lecture_session_id?: string
          locked_until?: string | null
          updated_at?: string
          window_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_billing_rate_limits_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_master_authorization_events: {
        Row: {
          actions: string[]
          actor_id: string
          authorization_id: string
          child_grant_id: string | null
          created_at: string
          event_type: string
          id: string
          lecture_session_id: string
          reason: string | null
          scope: string
        }
        Insert: {
          actions: string[]
          actor_id: string
          authorization_id: string
          child_grant_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lecture_session_id: string
          reason?: string | null
          scope: string
        }
        Update: {
          actions?: string[]
          actor_id?: string
          authorization_id?: string
          child_grant_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lecture_session_id?: string
          reason?: string | null
          scope?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_master_authorization_events_authorization_id_fkey"
            columns: ["authorization_id"]
            isOneToOne: false
            referencedRelation: "lecture_ai_master_authorizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_master_authorization_events_child_grant_id_fkey"
            columns: ["child_grant_id"]
            isOneToOne: false
            referencedRelation: "ai_billing_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_master_authorization_events_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_poll_proposals: {
        Row: {
          adopted_poll_id: string | null
          analysis_id: string
          correct_option_ids: string[]
          created_at: string
          difficulty: string
          educational_value: string
          evidence_excerpt_ids: string[]
          evidence_pages: number[]
          explanation: string
          id: string
          learning_objective: string
          lecture_session_id: string
          misconception_target: string | null
          model_id: string
          operation_id: string
          options: Json
          ordinal: number
          prompt_version: string
          proposal_type: string
          quality_score: number
          reviewed_at: string | null
          reviewed_by_actor: string | null
          source_document_id: string
          source_document_version: string
          source_text_sha256: string
          status: string
          stem: string
          updated_at: string
        }
        Insert: {
          adopted_poll_id?: string | null
          analysis_id: string
          correct_option_ids: string[]
          created_at?: string
          difficulty: string
          educational_value: string
          evidence_excerpt_ids: string[]
          evidence_pages: number[]
          explanation: string
          id?: string
          learning_objective: string
          lecture_session_id: string
          misconception_target?: string | null
          model_id: string
          operation_id: string
          options: Json
          ordinal: number
          prompt_version: string
          proposal_type: string
          quality_score: number
          reviewed_at?: string | null
          reviewed_by_actor?: string | null
          source_document_id: string
          source_document_version: string
          source_text_sha256: string
          status?: string
          stem: string
          updated_at?: string
        }
        Update: {
          adopted_poll_id?: string | null
          analysis_id?: string
          correct_option_ids?: string[]
          created_at?: string
          difficulty?: string
          educational_value?: string
          evidence_excerpt_ids?: string[]
          evidence_pages?: number[]
          explanation?: string
          id?: string
          learning_objective?: string
          lecture_session_id?: string
          misconception_target?: string | null
          model_id?: string
          operation_id?: string
          options?: Json
          ordinal?: number
          prompt_version?: string
          proposal_type?: string
          quality_score?: number
          reviewed_at?: string | null
          reviewed_by_actor?: string | null
          source_document_id?: string
          source_document_version?: string
          source_text_sha256?: string
          status?: string
          stem?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_poll_proposals_adopted_poll_id_fkey"
            columns: ["adopted_poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_poll_proposals_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "lecture_material_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_poll_proposals_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_poll_proposals_lecture_session_id_source_document_id_so_fkey"
            columns: [
              "lecture_session_id",
              "source_document_id",
              "source_document_version",
            ]
            isOneToOne: false
            referencedRelation: "lecture_pdf_documents"
            referencedColumns: [
              "lecture_session_id",
              "document_id",
              "document_version",
            ]
          },
          {
            foreignKeyName: "ai_poll_proposals_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "material_ai_operation_contexts"
            referencedColumns: ["operation_id"]
          },
        ]
      }
      ai_realtime_provider_calls: {
        Row: {
          activated_at: string | null
          actor_id: string
          attempt_count: number
          client_request_id: string | null
          created_at: string
          creation_outcome_uncertain: boolean
          last_error: string | null
          lease_until: string | null
          lecture_session_id: string
          next_attempt_at: string
          operation_id: string
          provider_call_id: string | null
          provider_request_id: string | null
          status: string
          stop_reason: string | null
          stop_requested_at: string | null
          stopped_at: string | null
          uncertainty_recorded_at: string | null
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          actor_id: string
          attempt_count?: number
          client_request_id?: string | null
          created_at?: string
          creation_outcome_uncertain?: boolean
          last_error?: string | null
          lease_until?: string | null
          lecture_session_id: string
          next_attempt_at?: string
          operation_id: string
          provider_call_id?: string | null
          provider_request_id?: string | null
          status?: string
          stop_reason?: string | null
          stop_requested_at?: string | null
          stopped_at?: string | null
          uncertainty_recorded_at?: string | null
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          actor_id?: string
          attempt_count?: number
          client_request_id?: string | null
          created_at?: string
          creation_outcome_uncertain?: boolean
          last_error?: string | null
          lease_until?: string | null
          lecture_session_id?: string
          next_attempt_at?: string
          operation_id?: string
          provider_call_id?: string | null
          provider_request_id?: string | null
          status?: string
          stop_reason?: string | null
          stop_requested_at?: string | null
          stopped_at?: string | null
          uncertainty_recorded_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_realtime_provider_calls_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_realtime_provider_calls_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "ai_usage_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_realtime_token_audit: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          lecture_session_id: string
          model_id: string
          operation_id: string
          outcome: string
          provider_request_id: string | null
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          lecture_session_id: string
          model_id: string
          operation_id: string
          outcome: string
          provider_request_id?: string | null
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          lecture_session_id?: string
          model_id?: string
          operation_id?: string
          outcome?: string
          provider_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_realtime_token_audit_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_realtime_token_audit_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "ai_usage_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_usage_ledger: {
        Row: {
          accounting_settled_at: string | null
          actual_audio_seconds: number | null
          actual_input_tokens: number | null
          actual_microusd: number | null
          actual_output_tokens: number | null
          error_code: string | null
          feature: string
          finished_at: string | null
          id: string
          idempotency_key: string
          last_heartbeat_at: string | null
          lecture_session_id: string
          model_id: string | null
          pricing_rate_microusd: number | null
          pricing_unit: string | null
          provider_dispatched_at: string | null
          provider_request_id: string | null
          requested_at: string
          requested_by_actor: string
          reserved_audio_seconds: number
          reserved_input_tokens: number
          reserved_microusd: number
          reserved_output_tokens: number
          result_accepted: boolean
          settlement_status: string | null
          status: string
        }
        Insert: {
          accounting_settled_at?: string | null
          actual_audio_seconds?: number | null
          actual_input_tokens?: number | null
          actual_microusd?: number | null
          actual_output_tokens?: number | null
          error_code?: string | null
          feature: string
          finished_at?: string | null
          id?: string
          idempotency_key: string
          last_heartbeat_at?: string | null
          lecture_session_id: string
          model_id?: string | null
          pricing_rate_microusd?: number | null
          pricing_unit?: string | null
          provider_dispatched_at?: string | null
          provider_request_id?: string | null
          requested_at?: string
          requested_by_actor: string
          reserved_audio_seconds?: number
          reserved_input_tokens?: number
          reserved_microusd?: number
          reserved_output_tokens?: number
          result_accepted?: boolean
          settlement_status?: string | null
          status?: string
        }
        Update: {
          accounting_settled_at?: string | null
          actual_audio_seconds?: number | null
          actual_input_tokens?: number | null
          actual_microusd?: number | null
          actual_output_tokens?: number | null
          error_code?: string | null
          feature?: string
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          last_heartbeat_at?: string | null
          lecture_session_id?: string
          model_id?: string | null
          pricing_rate_microusd?: number | null
          pricing_unit?: string | null
          provider_dispatched_at?: string | null
          provider_request_id?: string | null
          requested_at?: string
          requested_by_actor?: string
          reserved_audio_seconds?: number
          reserved_input_tokens?: number
          reserved_microusd?: number
          reserved_output_tokens?: number
          result_accepted?: boolean
          settlement_status?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_ledger_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      comment_like_totals: {
        Row: {
          comment_id: string
          lecture_session_id: string
          like_count: number
          updated_at: string
        }
        Insert: {
          comment_id: string
          lecture_session_id: string
          like_count?: number
          updated_at?: string
        }
        Update: {
          comment_id?: string
          lecture_session_id?: string
          like_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_like_totals_comment_id_lecture_session_id_fkey"
            columns: ["comment_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "lecture_session_id"]
          },
        ]
      }
      comment_likes: {
        Row: {
          comment_id: string
          created_at: string
          id: string
          lecture_session_id: string
          participant_id: string
        }
        Insert: {
          comment_id: string
          created_at?: string
          id?: string
          lecture_session_id: string
          participant_id: string
        }
        Update: {
          comment_id?: string
          created_at?: string
          id?: string
          lecture_session_id?: string
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_likes_comment_id_lecture_session_id_fkey"
            columns: ["comment_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "lecture_session_id"]
          },
          {
            foreignKeyName: "comment_likes_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comment_likes_participant_id_lecture_session_id_fkey"
            columns: ["participant_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "lecture_session_id"]
          },
        ]
      }
      comment_moderation_events: {
        Row: {
          action: string
          actor_id: string
          comment_id: string
          created_at: string
          id: number
          lecture_session_id: string
          next_is_pinned: boolean
          next_status: string
          previous_is_pinned: boolean
          previous_status: string
        }
        Insert: {
          action: string
          actor_id: string
          comment_id: string
          created_at?: string
          id?: never
          lecture_session_id: string
          next_is_pinned: boolean
          next_status: string
          previous_is_pinned: boolean
          previous_status: string
        }
        Update: {
          action?: string
          actor_id?: string
          comment_id?: string
          created_at?: string
          id?: never
          lecture_session_id?: string
          next_is_pinned?: boolean
          next_status?: string
          previous_is_pinned?: boolean
          previous_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "comment_moderation_events_comment_id_lecture_session_id_fkey"
            columns: ["comment_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "comments"
            referencedColumns: ["id", "lecture_session_id"]
          },
          {
            foreignKeyName: "comment_moderation_events_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      comments: {
        Row: {
          body: string
          created_at: string
          id: string
          is_pinned: boolean
          lecture_session_id: string
          nickname: string | null
          participant_id: string
          status: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          lecture_session_id: string
          nickname?: string | null
          participant_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          lecture_session_id?: string
          nickname?: string | null
          participant_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "comments_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comments_participant_id_lecture_session_id_fkey"
            columns: ["participant_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "lecture_session_id"]
          },
        ]
      }
      daily_operations_digest_jobs: {
        Row: {
          attempt_count: number
          created_at: string
          digest_date: string
          error_message: string | null
          id: string
          next_attempt_at: string
          provider_message_id: string | null
          recipient: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          digest_date: string
          error_message?: string | null
          id?: string
          next_attempt_at?: string
          provider_message_id?: string | null
          recipient: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          digest_date?: string
          error_message?: string | null
          id?: string
          next_attempt_at?: string
          provider_message_id?: string | null
          recipient?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      display_realtime_sessions: {
        Row: {
          admin_auth_user_id: string
          admin_session_id: string
          caption_control_relay_count: number
          caption_control_window_started_at: string | null
          claimed_at: string | null
          display_auth_user_id: string | null
          expires_at: string
          hard_stop_at: string
          id: string
          issued_at: string
          last_caption_delta_relay_at: string | null
          last_caption_relay_at: string | null
          last_caption_sequence: number | null
          last_caption_stream_id: string | null
          lecture_session_id: string
          revoke_reason: string | null
          revoked_at: string | null
          token_jti_hash: string
          topic: string
          updated_at: string
        }
        Insert: {
          admin_auth_user_id: string
          admin_session_id: string
          caption_control_relay_count?: number
          caption_control_window_started_at?: string | null
          claimed_at?: string | null
          display_auth_user_id?: string | null
          expires_at: string
          hard_stop_at: string
          id: string
          issued_at?: string
          last_caption_delta_relay_at?: string | null
          last_caption_relay_at?: string | null
          last_caption_sequence?: number | null
          last_caption_stream_id?: string | null
          lecture_session_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_jti_hash: string
          topic: string
          updated_at?: string
        }
        Update: {
          admin_auth_user_id?: string
          admin_session_id?: string
          caption_control_relay_count?: number
          caption_control_window_started_at?: string | null
          claimed_at?: string | null
          display_auth_user_id?: string | null
          expires_at?: string
          hard_stop_at?: string
          id?: string
          issued_at?: string
          last_caption_delta_relay_at?: string | null
          last_caption_relay_at?: string | null
          last_caption_sequence?: number | null
          last_caption_stream_id?: string | null
          lecture_session_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          token_jti_hash?: string
          topic?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "display_realtime_sessions_admin_session_id_fkey"
            columns: ["admin_session_id"]
            isOneToOne: false
            referencedRelation: "admin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "display_realtime_sessions_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_academic_answers: {
        Row: {
          created_at: string
          id: string
          lecture_session_id: string
          model_id: string
          operation_id: string
          prompt_version: string
          quality_result: Json
          question: string
          request_id: string
          source_kind: string
          source_set_sha256: string
          source_summary_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lecture_session_id: string
          model_id: string
          operation_id: string
          prompt_version: string
          quality_result?: Json
          question: string
          request_id: string
          source_kind: string
          source_set_sha256: string
          source_summary_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lecture_session_id?: string
          model_id?: string
          operation_id?: string
          prompt_version?: string
          quality_result?: Json
          question?: string
          request_id?: string
          source_kind?: string
          source_set_sha256?: string
          source_summary_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_academic_answers_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_academic_answers_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "ai_usage_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_academic_answers_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: true
            referencedRelation: "academic_answer_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_academic_answers_source_summary_id_fkey"
            columns: ["source_summary_id"]
            isOneToOne: false
            referencedRelation: "lecture_ai_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_admin_codes: {
        Row: {
          created_at: string
          lecture_code: string
          lecture_session_id: string
        }
        Insert: {
          created_at?: string
          lecture_code: string
          lecture_session_id: string
        }
        Update: {
          created_at?: string
          lecture_code?: string
          lecture_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_admin_codes_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_ai_control: {
        Row: {
          academic_answer_calls_used: number
          academic_answer_limit: number
          academic_answers_enabled: boolean
          active_operation_count: number
          audio_seconds_limit: number
          audio_seconds_used: number
          budget_limit_microusd: number
          captions_enabled: boolean
          created_at: string
          hard_stop_at: string | null
          input_token_limit: number
          input_tokens_used: number
          last_heartbeat_at: string | null
          lecture_session_id: string
          material_analysis_call_limit: number
          material_analysis_calls_used: number
          material_analysis_enabled: boolean
          max_concurrent_operations: number
          output_token_limit: number
          output_tokens_used: number
          poll_generation_calls_used: number
          poll_generation_limit: number
          poll_suggestions_enabled: boolean
          started_at: string | null
          status: string
          stop_reason: string | null
          stop_requested_at: string | null
          stopped_at: string | null
          summaries_enabled: boolean
          summary_call_limit: number
          summary_calls_used: number
          summary_language: string
          updated_at: string
          used_microusd: number
          version: number
        }
        Insert: {
          academic_answer_calls_used?: number
          academic_answer_limit?: number
          academic_answers_enabled?: boolean
          active_operation_count?: number
          audio_seconds_limit?: number
          audio_seconds_used?: number
          budget_limit_microusd?: number
          captions_enabled?: boolean
          created_at?: string
          hard_stop_at?: string | null
          input_token_limit?: number
          input_tokens_used?: number
          last_heartbeat_at?: string | null
          lecture_session_id: string
          material_analysis_call_limit?: number
          material_analysis_calls_used?: number
          material_analysis_enabled?: boolean
          max_concurrent_operations?: number
          output_token_limit?: number
          output_tokens_used?: number
          poll_generation_calls_used?: number
          poll_generation_limit?: number
          poll_suggestions_enabled?: boolean
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          stop_requested_at?: string | null
          stopped_at?: string | null
          summaries_enabled?: boolean
          summary_call_limit?: number
          summary_calls_used?: number
          summary_language?: string
          updated_at?: string
          used_microusd?: number
          version?: number
        }
        Update: {
          academic_answer_calls_used?: number
          academic_answer_limit?: number
          academic_answers_enabled?: boolean
          active_operation_count?: number
          audio_seconds_limit?: number
          audio_seconds_used?: number
          budget_limit_microusd?: number
          captions_enabled?: boolean
          created_at?: string
          hard_stop_at?: string | null
          input_token_limit?: number
          input_tokens_used?: number
          last_heartbeat_at?: string | null
          lecture_session_id?: string
          material_analysis_call_limit?: number
          material_analysis_calls_used?: number
          material_analysis_enabled?: boolean
          max_concurrent_operations?: number
          output_token_limit?: number
          output_tokens_used?: number
          poll_generation_calls_used?: number
          poll_generation_limit?: number
          poll_suggestions_enabled?: boolean
          started_at?: string | null
          status?: string
          stop_reason?: string | null
          stop_requested_at?: string | null
          stopped_at?: string | null
          summaries_enabled?: boolean
          summary_call_limit?: number
          summary_calls_used?: number
          summary_language?: string
          updated_at?: string
          used_microusd?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lecture_ai_control_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_ai_master_authorizations: {
        Row: {
          actions: string[]
          actor_id: string
          admin_session_id: string
          expires_at: string
          id: string
          issued_at: string
          last_used_at: string | null
          lecture_session_id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by_actor_id: string | null
          scope: string
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          actions: string[]
          actor_id: string
          admin_session_id: string
          expires_at: string
          id?: string
          issued_at?: string
          last_used_at?: string | null
          lecture_session_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by_actor_id?: string | null
          scope: string
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          actions?: string[]
          actor_id?: string
          admin_session_id?: string
          expires_at?: string
          id?: string
          issued_at?: string
          last_used_at?: string | null
          lecture_session_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by_actor_id?: string | null
          scope?: string
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lecture_ai_master_authorizations_admin_session_id_fkey"
            columns: ["admin_session_id"]
            isOneToOne: false
            referencedRelation: "admin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_ai_master_authorizations_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_ai_summaries: {
        Row: {
          ai_output: Json
          created_at: string
          id: string
          lecture_session_id: string
          model_id: string
          operation_id: string
          prompt_version: string
          quality_result: Json
          status: string
          window_id: string
        }
        Insert: {
          ai_output: Json
          created_at?: string
          id?: string
          lecture_session_id: string
          model_id: string
          operation_id: string
          prompt_version: string
          quality_result: Json
          status?: string
          window_id: string
        }
        Update: {
          ai_output?: Json
          created_at?: string
          id?: string
          lecture_session_id?: string
          model_id?: string
          operation_id?: string
          prompt_version?: string
          quality_result?: Json
          status?: string
          window_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_ai_summaries_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_ai_summaries_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "ai_usage_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_ai_summaries_window_id_fkey"
            columns: ["window_id"]
            isOneToOne: true
            referencedRelation: "lecture_summary_windows"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_ai_summary_revisions: {
        Row: {
          author_actor_id: string | null
          author_type: string
          body: Json
          created_at: string
          id: string
          reason: string | null
          revision_number: number
          summary_id: string
          supersedes_id: string | null
        }
        Insert: {
          author_actor_id?: string | null
          author_type: string
          body: Json
          created_at?: string
          id?: string
          reason?: string | null
          revision_number: number
          summary_id: string
          supersedes_id?: string | null
        }
        Update: {
          author_actor_id?: string | null
          author_type?: string
          body?: Json
          created_at?: string
          id?: string
          reason?: string | null
          revision_number?: number
          summary_id?: string
          supersedes_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lecture_ai_summary_revisions_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: false
            referencedRelation: "lecture_ai_summaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_ai_summary_revisions_supersedes_id_fkey"
            columns: ["supersedes_id"]
            isOneToOne: false
            referencedRelation: "lecture_ai_summary_revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_archive_exports: {
        Row: {
          attempt_count: number
          created_at: string
          exported_at: string | null
          last_error: string | null
          lease_until: string | null
          lecture_session_id: string
          next_attempt_at: string
          payload_sha256: string | null
          source_version: number
          status: string
          updated_at: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          exported_at?: string | null
          last_error?: string | null
          lease_until?: string | null
          lecture_session_id: string
          next_attempt_at?: string
          payload_sha256?: string | null
          source_version?: number
          status?: string
          updated_at?: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          exported_at?: string | null
          last_error?: string | null
          lease_until?: string | null
          lecture_session_id?: string
          next_attempt_at?: string
          payload_sha256?: string | null
          source_version?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_archive_exports_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_archive_state: {
        Row: {
          archived_at: string | null
          attempt_count: number
          eligible_at: string
          error_message: string | null
          last_attempt_at: string | null
          lecture_session_id: string
          restored_at: string | null
          status: string
          updated_at: string
          version: number
        }
        Insert: {
          archived_at?: string | null
          attempt_count?: number
          eligible_at: string
          error_message?: string | null
          last_attempt_at?: string | null
          lecture_session_id: string
          restored_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Update: {
          archived_at?: string | null
          attempt_count?: number
          eligible_at?: string
          error_message?: string | null
          last_attempt_at?: string | null
          lecture_session_id?: string
          restored_at?: string | null
          status?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lecture_archive_state_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_display_state: {
        Row: {
          current_pdf_page: number
          display_mode: string
          lecture_session_id: string
          updated_at: string
        }
        Insert: {
          current_pdf_page?: number
          display_mode?: string
          lecture_session_id: string
          updated_at?: string
        }
        Update: {
          current_pdf_page?: number
          display_mode?: string
          lecture_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_display_state_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_join_rate_limits: {
        Row: {
          auth_user_id: string
          failed_attempts: number
          last_failed_at: string | null
          locked_until: string | null
          updated_at: string
          window_started_at: string | null
        }
        Insert: {
          auth_user_id: string
          failed_attempts?: number
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
          window_started_at?: string | null
        }
        Update: {
          auth_user_id?: string
          failed_attempts?: number
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
          window_started_at?: string | null
        }
        Relationships: []
      }
      lecture_lifecycle_events: {
        Row: {
          actor_id: string | null
          actor_type: string
          effective_at: string
          event_key: string
          event_type: string
          id: number
          lecture_session_id: string
          metadata: Json
          reason: string | null
          recorded_at: string
        }
        Insert: {
          actor_id?: string | null
          actor_type: string
          effective_at: string
          event_key: string
          event_type: string
          id?: never
          lecture_session_id: string
          metadata?: Json
          reason?: string | null
          recorded_at?: string
        }
        Update: {
          actor_id?: string | null
          actor_type?: string
          effective_at?: string
          event_key?: string
          event_type?: string
          id?: never
          lecture_session_id?: string
          metadata?: Json
          reason?: string | null
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_lifecycle_events_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_live_state: {
        Row: {
          caption_version: number
          comments_version: number
          current_pdf_page: number
          display_mode: string
          display_version: number
          hidden_comment_count: number
          lecture_session_id: string
          lecture_version: number
          likes_version: number
          metrics_updated_at: string
          metrics_version: number
          participant_count: number
          pdf_document_id: string | null
          pdf_document_version: string | null
          pdf_manifest_version: number
          pdf_page_count: number | null
          pdf_version: number
          pdf_visible: boolean
          polls_version: number
          state_version: number
          summaries_version: number
          updated_at: string
          visible_comment_count: number
          visible_comments_version: number
        }
        Insert: {
          caption_version?: number
          comments_version?: number
          current_pdf_page?: number
          display_mode?: string
          display_version?: number
          hidden_comment_count?: number
          lecture_session_id: string
          lecture_version?: number
          likes_version?: number
          metrics_updated_at?: string
          metrics_version?: number
          participant_count?: number
          pdf_document_id?: string | null
          pdf_document_version?: string | null
          pdf_manifest_version?: number
          pdf_page_count?: number | null
          pdf_version?: number
          pdf_visible?: boolean
          polls_version?: number
          state_version?: number
          summaries_version?: number
          updated_at?: string
          visible_comment_count?: number
          visible_comments_version?: number
        }
        Update: {
          caption_version?: number
          comments_version?: number
          current_pdf_page?: number
          display_mode?: string
          display_version?: number
          hidden_comment_count?: number
          lecture_session_id?: string
          lecture_version?: number
          likes_version?: number
          metrics_updated_at?: string
          metrics_version?: number
          participant_count?: number
          pdf_document_id?: string | null
          pdf_document_version?: string | null
          pdf_manifest_version?: number
          pdf_page_count?: number | null
          pdf_version?: number
          pdf_visible?: boolean
          polls_version?: number
          state_version?: number
          summaries_version?: number
          updated_at?: string
          visible_comment_count?: number
          visible_comments_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lecture_live_state_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_material_analyses: {
        Row: {
          created_at: string
          id: string
          important_pages: number[]
          input_price_microusd_per_million: number
          key_terms: Json
          lecture_session_id: string
          material_outline: Json
          material_summary: string
          model_id: string
          operation_id: string
          output_price_microusd_per_million: number
          prompt_version: string
          section_boundaries: Json
          source_document_id: string
          source_document_version: string
          source_text_sha256: string
          status: string
          superseded_at: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          important_pages: number[]
          input_price_microusd_per_million: number
          key_terms: Json
          lecture_session_id: string
          material_outline: Json
          material_summary: string
          model_id: string
          operation_id: string
          output_price_microusd_per_million: number
          prompt_version: string
          section_boundaries: Json
          source_document_id: string
          source_document_version: string
          source_text_sha256: string
          status?: string
          superseded_at?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          important_pages?: number[]
          input_price_microusd_per_million?: number
          key_terms?: Json
          lecture_session_id?: string
          material_outline?: Json
          material_summary?: string
          model_id?: string
          operation_id?: string
          output_price_microusd_per_million?: number
          prompt_version?: string
          section_boundaries?: Json
          source_document_id?: string
          source_document_version?: string
          source_text_sha256?: string
          status?: string
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lecture_material_analyses_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_material_analyses_lecture_session_id_source_docume_fkey"
            columns: [
              "lecture_session_id",
              "source_document_id",
              "source_document_version",
            ]
            isOneToOne: false
            referencedRelation: "lecture_pdf_documents"
            referencedColumns: [
              "lecture_session_id",
              "document_id",
              "document_version",
            ]
          },
          {
            foreignKeyName: "lecture_material_analyses_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "material_ai_operation_contexts"
            referencedColumns: ["operation_id"]
          },
        ]
      }
      lecture_material_summary_publications: {
        Row: {
          analysis_id: string
          body: Json
          created_at: string
          lecture_session_id: string
          published_at: string | null
          review_state: string
          reviewed_by_actor_id: string
          updated_at: string
          version: number
          visibility: string
        }
        Insert: {
          analysis_id: string
          body: Json
          created_at?: string
          lecture_session_id: string
          published_at?: string | null
          review_state: string
          reviewed_by_actor_id: string
          updated_at?: string
          version?: number
          visibility: string
        }
        Update: {
          analysis_id?: string
          body?: Json
          created_at?: string
          lecture_session_id?: string
          published_at?: string | null
          review_state?: string
          reviewed_by_actor_id?: string
          updated_at?: string
          version?: number
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_material_summary_publ_lecture_session_id_analysis__fkey"
            columns: ["lecture_session_id", "analysis_id"]
            isOneToOne: false
            referencedRelation: "lecture_material_analyses"
            referencedColumns: ["lecture_session_id", "id"]
          },
          {
            foreignKeyName: "lecture_material_summary_publications_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_participant_presence: {
        Row: {
          last_seen_at: string
          lecture_session_id: string
          participant_id: string
        }
        Insert: {
          last_seen_at?: string
          lecture_session_id: string
          participant_id: string
        }
        Update: {
          last_seen_at?: string
          lecture_session_id?: string
          participant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_participant_presence_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_participant_presence_participant_id_lecture_sessio_fkey"
            columns: ["participant_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "lecture_session_id"]
          },
        ]
      }
      lecture_pdf_documents: {
        Row: {
          archive_expires_at: string | null
          browser_publication_id: string | null
          byte_size: number
          created_at: string
          delete_after: string | null
          display_name: string
          document_id: string
          document_version: string
          download_enabled: boolean
          lecture_session_id: string
          local_manifest_etag: string | null
          manifest_version: number
          page_count: number
          pdf_sha256: string
          published_at: string
          retired_at: string | null
          text_char_count: number
          text_sha256: string
          updated_at: string
          visible: boolean
        }
        Insert: {
          archive_expires_at?: string | null
          browser_publication_id?: string | null
          byte_size: number
          created_at?: string
          delete_after?: string | null
          display_name: string
          document_id: string
          document_version: string
          download_enabled?: boolean
          lecture_session_id: string
          local_manifest_etag?: string | null
          manifest_version: number
          page_count: number
          pdf_sha256: string
          published_at?: string
          retired_at?: string | null
          text_char_count: number
          text_sha256: string
          updated_at?: string
          visible?: boolean
        }
        Update: {
          archive_expires_at?: string | null
          browser_publication_id?: string | null
          byte_size?: number
          created_at?: string
          delete_after?: string | null
          display_name?: string
          document_id?: string
          document_version?: string
          download_enabled?: boolean
          lecture_session_id?: string
          local_manifest_etag?: string | null
          manifest_version?: number
          page_count?: number
          pdf_sha256?: string
          published_at?: string
          retired_at?: string | null
          text_char_count?: number
          text_sha256?: string
          updated_at?: string
          visible?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "lecture_pdf_documents_browser_publication_id_fkey"
            columns: ["browser_publication_id"]
            isOneToOne: false
            referencedRelation: "lecture_pdf_publications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_pdf_documents_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_pdf_publication_events: {
        Row: {
          actor_id: string
          actor_type: string
          details: Json
          event_type: string
          id: string
          lecture_session_id: string
          publication_id: string
          recorded_at: string
          state_from: string | null
          state_to: string
        }
        Insert: {
          actor_id: string
          actor_type: string
          details?: Json
          event_type: string
          id?: string
          lecture_session_id: string
          publication_id: string
          recorded_at?: string
          state_from?: string | null
          state_to: string
        }
        Update: {
          actor_id?: string
          actor_type?: string
          details?: Json
          event_type?: string
          id?: string
          lecture_session_id?: string
          publication_id?: string
          recorded_at?: string
          state_from?: string | null
          state_to?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_pdf_publication_events_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_pdf_publication_events_publication_id_fkey"
            columns: ["publication_id"]
            isOneToOne: false
            referencedRelation: "lecture_pdf_publications"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_pdf_publications: {
        Row: {
          aborted_at: string | null
          activated_manifest_etag: string | null
          activated_manifest_version: number | null
          activation_lease_expires_at: string | null
          activation_operation_id: string | null
          activation_target_access_version: number | null
          active_at: string | null
          actual_byte_size: number | null
          actual_pdf_sha256: string | null
          allowed_origin: string
          cleanup_after: string | null
          cleanup_attempt_count: number
          cleanup_claim_id: string | null
          cleanup_completed_at: string | null
          cleanup_exhausted_at: string | null
          cleanup_lease_expires_at: string | null
          cleanup_worker_generation: number | null
          client_request_id: string
          commit_lease_expires_at: string | null
          commit_operation_id: string | null
          committed_at: string | null
          committed_manifest_access_version: number | null
          committed_manifest_etag: string | null
          committed_manifest_version: number | null
          created_at: string
          declared_page_count: number
          declared_text_char_count: number
          declared_text_sha256: string
          display_name: string
          document_id: string
          download_enabled: boolean
          expected_byte_size: number
          expected_pdf_sha256: string
          expired_at: string | null
          id: string
          last_error_code: string | null
          lecture_session_id: string
          nonce_hash: string
          nonce_used_at: string | null
          operation_expires_at: string
          pdf_magic_verified: boolean | null
          r2_etag: string | null
          r2_object_version: string | null
          request_fingerprint: string
          requested_by_admin_session_id: string
          requested_by_auth_user_id: string
          retired_at: string | null
          state: string
          state_version: number
          ticket_admin_session_id: string
          ticket_expires_at: string
          ticket_generation: number
          ticket_jti_hash: string
          updated_at: string
          upload_lease_expires_at: string | null
          uploaded_at: string | null
          worker_attempt_id: string | null
        }
        Insert: {
          aborted_at?: string | null
          activated_manifest_etag?: string | null
          activated_manifest_version?: number | null
          activation_lease_expires_at?: string | null
          activation_operation_id?: string | null
          activation_target_access_version?: number | null
          active_at?: string | null
          actual_byte_size?: number | null
          actual_pdf_sha256?: string | null
          allowed_origin: string
          cleanup_after?: string | null
          cleanup_attempt_count?: number
          cleanup_claim_id?: string | null
          cleanup_completed_at?: string | null
          cleanup_exhausted_at?: string | null
          cleanup_lease_expires_at?: string | null
          cleanup_worker_generation?: number | null
          client_request_id: string
          commit_lease_expires_at?: string | null
          commit_operation_id?: string | null
          committed_at?: string | null
          committed_manifest_access_version?: number | null
          committed_manifest_etag?: string | null
          committed_manifest_version?: number | null
          created_at?: string
          declared_page_count: number
          declared_text_char_count: number
          declared_text_sha256: string
          display_name: string
          document_id: string
          download_enabled?: boolean
          expected_byte_size: number
          expected_pdf_sha256: string
          expired_at?: string | null
          id?: string
          last_error_code?: string | null
          lecture_session_id: string
          nonce_hash: string
          nonce_used_at?: string | null
          operation_expires_at: string
          pdf_magic_verified?: boolean | null
          r2_etag?: string | null
          r2_object_version?: string | null
          request_fingerprint: string
          requested_by_admin_session_id: string
          requested_by_auth_user_id: string
          retired_at?: string | null
          state?: string
          state_version?: number
          ticket_admin_session_id: string
          ticket_expires_at: string
          ticket_generation?: number
          ticket_jti_hash: string
          updated_at?: string
          upload_lease_expires_at?: string | null
          uploaded_at?: string | null
          worker_attempt_id?: string | null
        }
        Update: {
          aborted_at?: string | null
          activated_manifest_etag?: string | null
          activated_manifest_version?: number | null
          activation_lease_expires_at?: string | null
          activation_operation_id?: string | null
          activation_target_access_version?: number | null
          active_at?: string | null
          actual_byte_size?: number | null
          actual_pdf_sha256?: string | null
          allowed_origin?: string
          cleanup_after?: string | null
          cleanup_attempt_count?: number
          cleanup_claim_id?: string | null
          cleanup_completed_at?: string | null
          cleanup_exhausted_at?: string | null
          cleanup_lease_expires_at?: string | null
          cleanup_worker_generation?: number | null
          client_request_id?: string
          commit_lease_expires_at?: string | null
          commit_operation_id?: string | null
          committed_at?: string | null
          committed_manifest_access_version?: number | null
          committed_manifest_etag?: string | null
          committed_manifest_version?: number | null
          created_at?: string
          declared_page_count?: number
          declared_text_char_count?: number
          declared_text_sha256?: string
          display_name?: string
          document_id?: string
          download_enabled?: boolean
          expected_byte_size?: number
          expected_pdf_sha256?: string
          expired_at?: string | null
          id?: string
          last_error_code?: string | null
          lecture_session_id?: string
          nonce_hash?: string
          nonce_used_at?: string | null
          operation_expires_at?: string
          pdf_magic_verified?: boolean | null
          r2_etag?: string | null
          r2_object_version?: string | null
          request_fingerprint?: string
          requested_by_admin_session_id?: string
          requested_by_auth_user_id?: string
          retired_at?: string | null
          state?: string
          state_version?: number
          ticket_admin_session_id?: string
          ticket_expires_at?: string
          ticket_generation?: number
          ticket_jti_hash?: string
          updated_at?: string
          upload_lease_expires_at?: string | null
          uploaded_at?: string | null
          worker_attempt_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lecture_pdf_publications_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_pdf_publications_requested_by_admin_session_id_fkey"
            columns: ["requested_by_admin_session_id"]
            isOneToOne: false
            referencedRelation: "admin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_pdf_publications_ticket_admin_session_id_fkey"
            columns: ["ticket_admin_session_id"]
            isOneToOne: false
            referencedRelation: "admin_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_presence_metrics: {
        Row: {
          bucket_started_at: string
          lecture_session_id: string
          participant_count: number
          updated_at: string
        }
        Insert: {
          bucket_started_at: string
          lecture_session_id: string
          participant_count?: number
          updated_at?: string
        }
        Update: {
          bucket_started_at?: string
          lecture_session_id?: string
          participant_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_presence_metrics_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_public_captions: {
        Row: {
          language: string
          last_item_id: string
          lecture_session_id: string
          sequence: number
          text: string
          updated_at: string
          window_ended_at: string
          window_started_at: string
        }
        Insert: {
          language?: string
          last_item_id: string
          lecture_session_id: string
          sequence: number
          text: string
          updated_at?: string
          window_ended_at: string
          window_started_at: string
        }
        Update: {
          language?: string
          last_item_id?: string
          lecture_session_id?: string
          sequence?: number
          text?: string
          updated_at?: string
          window_ended_at?: string
          window_started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_public_captions_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_resume_token_revocations: {
        Row: {
          actor_id: string
          created_at: string
          id: number
          lecture_session_id: string
          next_version: number
          previous_version: number
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: never
          lecture_session_id: string
          next_version: number
          previous_version: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: never
          lecture_session_id?: string
          next_version?: number
          previous_version?: number
        }
        Relationships: [
          {
            foreignKeyName: "lecture_resume_token_revocations_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_sessions: {
        Row: {
          archive_expires_at: string | null
          close_actor_id: string | null
          close_actor_type: string | null
          close_reason: string | null
          closed_at: string | null
          code_hash: string
          created_at: string
          duplicated_from_lecture_session_id: string | null
          ends_at: string | null
          hard_stop_at: string | null
          id: string
          lifecycle_version: number
          pdf_access_version: number
          pdf_public_id: string
          resume_token_version: number
          started_at: string | null
          starts_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          archive_expires_at?: string | null
          close_actor_id?: string | null
          close_actor_type?: string | null
          close_reason?: string | null
          closed_at?: string | null
          code_hash: string
          created_at?: string
          duplicated_from_lecture_session_id?: string | null
          ends_at?: string | null
          hard_stop_at?: string | null
          id?: string
          lifecycle_version?: number
          pdf_access_version?: number
          pdf_public_id?: string
          resume_token_version?: number
          started_at?: string | null
          starts_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          archive_expires_at?: string | null
          close_actor_id?: string | null
          close_actor_type?: string | null
          close_reason?: string | null
          closed_at?: string | null
          code_hash?: string
          created_at?: string
          duplicated_from_lecture_session_id?: string | null
          ends_at?: string | null
          hard_stop_at?: string | null
          id?: string
          lifecycle_version?: number
          pdf_access_version?: number
          pdf_public_id?: string
          resume_token_version?: number
          started_at?: string | null
          starts_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_sessions_duplicated_from_lecture_session_id_fkey"
            columns: ["duplicated_from_lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_summary_runs: {
        Row: {
          academic_authorization_grant_id: string | null
          academic_source_policy: string
          actor_id: string
          auto_academic_answers_enabled: boolean
          created_at: string
          expires_at: string
          id: string
          last_window_index: number
          lecture_session_id: string
          previous_academic_answers_enabled: boolean
          started_at: string
          status: string
          stop_reason: string | null
          stopped_at: string | null
          token_hash: string
          updated_at: string
        }
        Insert: {
          academic_authorization_grant_id?: string | null
          academic_source_policy?: string
          actor_id: string
          auto_academic_answers_enabled?: boolean
          created_at?: string
          expires_at: string
          id?: string
          last_window_index?: number
          lecture_session_id: string
          previous_academic_answers_enabled?: boolean
          started_at?: string
          status?: string
          stop_reason?: string | null
          stopped_at?: string | null
          token_hash: string
          updated_at?: string
        }
        Update: {
          academic_authorization_grant_id?: string | null
          academic_source_policy?: string
          actor_id?: string
          auto_academic_answers_enabled?: boolean
          created_at?: string
          expires_at?: string
          id?: string
          last_window_index?: number
          lecture_session_id?: string
          previous_academic_answers_enabled?: boolean
          started_at?: string
          status?: string
          stop_reason?: string | null
          stopped_at?: string | null
          token_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_summary_runs_academic_authorization_grant_id_fkey"
            columns: ["academic_authorization_grant_id"]
            isOneToOne: false
            referencedRelation: "ai_billing_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_summary_runs_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      lecture_summary_windows: {
        Row: {
          attempt_count: number
          created_at: string
          current_operation_id: string | null
          id: string
          language_reason: string | null
          language_recorded_at: string | null
          last_error_code: string | null
          lecture_session_id: string
          prompt_version: string
          requested_language: string
          resolved_language: string | null
          run_id: string
          source_coverage: Json
          source_hashes: Json
          status: string
          updated_at: string
          window_end: string
          window_index: number
          window_start: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          current_operation_id?: string | null
          id?: string
          language_reason?: string | null
          language_recorded_at?: string | null
          last_error_code?: string | null
          lecture_session_id: string
          prompt_version: string
          requested_language?: string
          resolved_language?: string | null
          run_id: string
          source_coverage?: Json
          source_hashes?: Json
          status?: string
          updated_at?: string
          window_end: string
          window_index: number
          window_start: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          current_operation_id?: string | null
          id?: string
          language_reason?: string | null
          language_recorded_at?: string | null
          last_error_code?: string | null
          lecture_session_id?: string
          prompt_version?: string
          requested_language?: string
          resolved_language?: string | null
          run_id?: string
          source_coverage?: Json
          source_hashes?: Json
          status?: string
          updated_at?: string
          window_end?: string
          window_index?: number
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "lecture_summary_windows_current_operation_id_fkey"
            columns: ["current_operation_id"]
            isOneToOne: false
            referencedRelation: "ai_usage_ledger"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_summary_windows_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lecture_summary_windows_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "lecture_summary_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      material_ai_operation_contexts: {
        Row: {
          analysis_id: string | null
          created_at: string
          feature: string
          input_price_microusd_per_million: number
          lecture_session_id: string
          max_output_tokens: number
          model_id: string
          operation_id: string
          output_price_microusd_per_million: number
          prompt_version: string
          requested_page_end: number | null
          requested_page_start: number | null
          result_committed_at: string | null
          source_document_id: string
          source_document_version: string
          source_text_sha256: string
          updated_at: string
        }
        Insert: {
          analysis_id?: string | null
          created_at?: string
          feature: string
          input_price_microusd_per_million: number
          lecture_session_id: string
          max_output_tokens: number
          model_id: string
          operation_id: string
          output_price_microusd_per_million: number
          prompt_version: string
          requested_page_end?: number | null
          requested_page_start?: number | null
          result_committed_at?: string | null
          source_document_id: string
          source_document_version: string
          source_text_sha256: string
          updated_at?: string
        }
        Update: {
          analysis_id?: string | null
          created_at?: string
          feature?: string
          input_price_microusd_per_million?: number
          lecture_session_id?: string
          max_output_tokens?: number
          model_id?: string
          operation_id?: string
          output_price_microusd_per_million?: number
          prompt_version?: string
          requested_page_end?: number | null
          requested_page_start?: number | null
          result_committed_at?: string | null
          source_document_id?: string
          source_document_version?: string
          source_text_sha256?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "material_ai_operation_context_lecture_session_id_source_do_fkey"
            columns: [
              "lecture_session_id",
              "source_document_id",
              "source_document_version",
            ]
            isOneToOne: false
            referencedRelation: "lecture_pdf_documents"
            referencedColumns: [
              "lecture_session_id",
              "document_id",
              "document_version",
            ]
          },
          {
            foreignKeyName: "material_ai_operation_contexts_analysis_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "lecture_material_analyses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_ai_operation_contexts_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "material_ai_operation_contexts_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: true
            referencedRelation: "ai_usage_ledger"
            referencedColumns: ["id"]
          },
        ]
      }
      participants: {
        Row: {
          auth_user_id: string | null
          id: string
          joined_at: string
          last_seen_at: string | null
          lecture_session_id: string
          participant_key: string
        }
        Insert: {
          auth_user_id?: string | null
          id?: string
          joined_at?: string
          last_seen_at?: string | null
          lecture_session_id: string
          participant_key: string
        }
        Update: {
          auth_user_id?: string | null
          id?: string
          joined_at?: string
          last_seen_at?: string | null
          lecture_session_id?: string
          participant_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "participants_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      phase727_journal_club_poll_slots: {
        Row: {
          created_at: string
          display_order: number
          lecture_session_id: string
          poll_id: string
        }
        Insert: {
          created_at?: string
          display_order: number
          lecture_session_id: string
          poll_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          lecture_session_id?: string
          poll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "phase727_journal_club_poll_slot_poll_id_lecture_session_id_fkey"
            columns: ["poll_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id", "lecture_session_id"]
          },
          {
            foreignKeyName: "phase727_journal_club_poll_slots_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "phase727_journal_club_runs"
            referencedColumns: ["lecture_session_id"]
          },
        ]
      }
      phase727_journal_club_runs: {
        Row: {
          client_request_id: string
          created_at: string
          created_by_admin_session_id: string
          created_by_auth_user_id: string
          event_key: string
          expected_document_id: string
          expected_pdf_byte_size: number
          expected_pdf_page_count: number
          expected_pdf_sha256: string
          lecture_session_id: string
          preset_version: number
          run_kind: string
        }
        Insert: {
          client_request_id: string
          created_at?: string
          created_by_admin_session_id: string
          created_by_auth_user_id: string
          event_key?: string
          expected_document_id?: string
          expected_pdf_byte_size?: number
          expected_pdf_page_count?: number
          expected_pdf_sha256?: string
          lecture_session_id: string
          preset_version?: number
          run_kind: string
        }
        Update: {
          client_request_id?: string
          created_at?: string
          created_by_admin_session_id?: string
          created_by_auth_user_id?: string
          event_key?: string
          expected_document_id?: string
          expected_pdf_byte_size?: number
          expected_pdf_page_count?: number
          expected_pdf_sha256?: string
          lecture_session_id?: string
          preset_version?: number
          run_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "phase727_journal_club_runs_created_by_admin_session_id_fkey"
            columns: ["created_by_admin_session_id"]
            isOneToOne: false
            referencedRelation: "admin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "phase727_journal_club_runs_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: true
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      poll_option_totals: {
        Row: {
          lecture_session_id: string
          option_id: string
          poll_id: string
          response_count: number
          updated_at: string
        }
        Insert: {
          lecture_session_id: string
          option_id: string
          poll_id: string
          response_count?: number
          updated_at?: string
        }
        Update: {
          lecture_session_id?: string
          option_id?: string
          poll_id?: string
          response_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_option_totals_option_id_poll_id_fkey"
            columns: ["option_id", "poll_id"]
            isOneToOne: false
            referencedRelation: "poll_options"
            referencedColumns: ["id", "poll_id"]
          },
          {
            foreignKeyName: "poll_option_totals_poll_id_lecture_session_id_fkey"
            columns: ["poll_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id", "lecture_session_id"]
          },
        ]
      }
      poll_options: {
        Row: {
          created_at: string
          display_order: number
          id: string
          label: string
          lecture_session_id: string
          poll_id: string
        }
        Insert: {
          created_at?: string
          display_order: number
          id?: string
          label: string
          lecture_session_id: string
          poll_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          label?: string
          lecture_session_id?: string
          poll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_options_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_options_poll_id_lecture_session_id_fkey"
            columns: ["poll_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id", "lecture_session_id"]
          },
        ]
      }
      poll_responses: {
        Row: {
          created_at: string
          id: string
          lecture_session_id: string
          option_ids: string[]
          participant_id: string
          poll_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lecture_session_id: string
          option_ids: string[]
          participant_id: string
          poll_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lecture_session_id?: string
          option_ids?: string[]
          participant_id?: string
          poll_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_responses_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_responses_participant_id_lecture_session_id_fkey"
            columns: ["participant_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "participants"
            referencedColumns: ["id", "lecture_session_id"]
          },
          {
            foreignKeyName: "poll_responses_poll_id_lecture_session_id_fkey"
            columns: ["poll_id", "lecture_session_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id", "lecture_session_id"]
          },
        ]
      }
      poll_result_refresh_events: {
        Row: {
          created_at: string
          id: string
          lecture_session_id: string
          poll_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lecture_session_id: string
          poll_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lecture_session_id?: string
          poll_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "poll_result_refresh_events_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "poll_result_refresh_events_poll_id_fkey"
            columns: ["poll_id"]
            isOneToOne: false
            referencedRelation: "polls"
            referencedColumns: ["id"]
          },
        ]
      }
      polls: {
        Row: {
          created_at: string
          id: string
          lecture_session_id: string
          question: string
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lecture_session_id: string
          question: string
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lecture_session_id?: string
          question?: string
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "polls_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      presenter_connection_events: {
        Row: {
          actor_id: string
          connection_id: string
          created_at: string
          event_type: string
          id: number
          lecture_session_id: string
        }
        Insert: {
          actor_id: string
          connection_id: string
          created_at?: string
          event_type: string
          id?: never
          lecture_session_id: string
        }
        Update: {
          actor_id?: string
          connection_id?: string
          created_at?: string
          event_type?: string
          id?: never
          lecture_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "presenter_connection_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "presenter_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presenter_connection_events_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      presenter_connections: {
        Row: {
          admin_auth_user_id: string
          admin_session_id: string
          capability_expires_at: string | null
          capability_jti_hash: string | null
          claimed_at: string | null
          confirmed_at: string | null
          custom_show_active: boolean | null
          hard_stop_at: string
          hidden_slide_count: number | null
          id: string
          inspected_at: string | null
          installation_hash: string | null
          issued_at: string
          last_committed_pdf_page: number | null
          last_event_id: string | null
          last_request_at: string | null
          last_seen_at: string | null
          last_sequence: number
          last_slide_id: number | null
          last_slide_index: number | null
          lecture_session_id: string
          manual_code_hmac: string
          pdf_document_id: string
          pdf_document_version: string
          pdf_manifest_version: number
          pdf_page_count: number
          pptx_file_sha256: string | null
          proof_key_id: string | null
          proof_public_key_spki: string | null
          revoke_reason: string | null
          revoked_at: string | null
          slide_count: number | null
          slide_id_order_sha256: string | null
          state: string
          ticket_consumed_at: string | null
          ticket_expires_at: string
          ticket_jti_hash: string
          updated_at: string
        }
        Insert: {
          admin_auth_user_id: string
          admin_session_id: string
          capability_expires_at?: string | null
          capability_jti_hash?: string | null
          claimed_at?: string | null
          confirmed_at?: string | null
          custom_show_active?: boolean | null
          hard_stop_at: string
          hidden_slide_count?: number | null
          id?: string
          inspected_at?: string | null
          installation_hash?: string | null
          issued_at?: string
          last_committed_pdf_page?: number | null
          last_event_id?: string | null
          last_request_at?: string | null
          last_seen_at?: string | null
          last_sequence?: number
          last_slide_id?: number | null
          last_slide_index?: number | null
          lecture_session_id: string
          manual_code_hmac: string
          pdf_document_id: string
          pdf_document_version: string
          pdf_manifest_version: number
          pdf_page_count: number
          pptx_file_sha256?: string | null
          proof_key_id?: string | null
          proof_public_key_spki?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          slide_count?: number | null
          slide_id_order_sha256?: string | null
          state?: string
          ticket_consumed_at?: string | null
          ticket_expires_at: string
          ticket_jti_hash: string
          updated_at?: string
        }
        Update: {
          admin_auth_user_id?: string
          admin_session_id?: string
          capability_expires_at?: string | null
          capability_jti_hash?: string | null
          claimed_at?: string | null
          confirmed_at?: string | null
          custom_show_active?: boolean | null
          hard_stop_at?: string
          hidden_slide_count?: number | null
          id?: string
          inspected_at?: string | null
          installation_hash?: string | null
          issued_at?: string
          last_committed_pdf_page?: number | null
          last_event_id?: string | null
          last_request_at?: string | null
          last_seen_at?: string | null
          last_sequence?: number
          last_slide_id?: number | null
          last_slide_index?: number | null
          lecture_session_id?: string
          manual_code_hmac?: string
          pdf_document_id?: string
          pdf_document_version?: string
          pdf_manifest_version?: number
          pdf_page_count?: number
          pptx_file_sha256?: string | null
          proof_key_id?: string | null
          proof_public_key_spki?: string | null
          revoke_reason?: string | null
          revoked_at?: string | null
          slide_count?: number | null
          slide_id_order_sha256?: string | null
          state?: string
          ticket_consumed_at?: string | null
          ticket_expires_at?: string
          ticket_jti_hash?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "presenter_connections_admin_session_id_fkey"
            columns: ["admin_session_id"]
            isOneToOne: false
            referencedRelation: "admin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presenter_connections_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      summary_publications: {
        Row: {
          active_revision_id: string
          lecture_session_id: string
          pinned_order: number | null
          pinned_until: string | null
          published_at: string | null
          review_state: string
          reviewed_by_actor: string | null
          summary_id: string
          updated_at: string
          visibility: string
        }
        Insert: {
          active_revision_id: string
          lecture_session_id: string
          pinned_order?: number | null
          pinned_until?: string | null
          published_at?: string | null
          review_state?: string
          reviewed_by_actor?: string | null
          summary_id: string
          updated_at?: string
          visibility?: string
        }
        Update: {
          active_revision_id?: string
          lecture_session_id?: string
          pinned_order?: number | null
          pinned_until?: string | null
          published_at?: string | null
          review_state?: string
          reviewed_by_actor?: string | null
          summary_id?: string
          updated_at?: string
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "summary_publications_active_revision_id_summary_id_fkey"
            columns: ["active_revision_id", "summary_id"]
            isOneToOne: false
            referencedRelation: "lecture_ai_summary_revisions"
            referencedColumns: ["id", "summary_id"]
          },
          {
            foreignKeyName: "summary_publications_lecture_session_id_fkey"
            columns: ["lecture_session_id"]
            isOneToOne: false
            referencedRelation: "lecture_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "summary_publications_summary_id_fkey"
            columns: ["summary_id"]
            isOneToOne: true
            referencedRelation: "lecture_ai_summaries"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_abort_pdf_publication_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_publication_id: string
          target_reason_code: string
        }
        Returns: Json
      }
      admin_activate_realtime_provider_call: {
        Args: {
          target_actor_id: string
          target_operation_id: string
          target_provider_call_id: string
          target_provider_request_id?: string
        }
        Returns: Json
      }
      admin_adopt_poll_proposal: {
        Args: {
          option_labels: string[]
          poll_question: string
          poll_type: string
          target_actor_id: string
          target_lecture_session_id: string
          target_proposal_id: string
        }
        Returns: string
      }
      admin_authorize_ai_master: {
        Args: {
          pin_succeeded: boolean
          target_actor_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
          target_scope: string
        }
        Returns: Json
      }
      admin_cancel_academic_answer_request: {
        Args: {
          target_actor_id: string
          target_lecture_session_id: string
          target_request_id: string
        }
        Returns: Json
      }
      admin_complete_academic_answer_operation: {
        Args: {
          actual_input_tokens: number
          actual_microusd: number
          actual_output_tokens: number
          provider_request_id: string
          target_actor_id: string
          target_body: Json
          target_operation_id: string
          target_quality_result: Json
          target_request_id: string
          target_sources: Json
        }
        Returns: Json
      }
      admin_complete_material_ai_operation: {
        Args: {
          actual_input_tokens: number
          actual_microusd: number
          actual_output_tokens: number
          provider_request_id: string
          target_actor_id: string
          target_operation_id: string
          target_result: Json
        }
        Returns: Json
      }
      admin_complete_pdf_publication_activation_v1: {
        Args: {
          target_activation_operation_id: string
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_manifest_access_version: number
          target_manifest_etag: string
          target_manifest_version: number
          target_publication_id: string
        }
        Returns: Json
      }
      admin_complete_pdf_publication_commit_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_commit_operation_id: string
          target_manifest_access_version: number
          target_manifest_etag: string
          target_manifest_version: number
          target_publication_id: string
        }
        Returns: Json
      }
      admin_complete_summary_window_operation: {
        Args: {
          actual_input_tokens: number
          actual_microusd: number
          actual_output_tokens: number
          provider_request_id: string
          publish_recommended: boolean
          target_actor_id: string
          target_ai_output: Json
          target_model_id: string
          target_operation_id: string
          target_quality_result: Json
          target_run_id: string
        }
        Returns: Json
      }
      admin_configure_lecture_ai_control: {
        Args: {
          configuration: Json
          target_actor_id?: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_consume_ai_billing_grant: {
        Args: {
          target_actor_id: string
          target_grant_id: string
          target_lecture_session_id: string
          target_nonce_hash: string
          target_operations: Json
        }
        Returns: Json
      }
      admin_consume_realtime_billing_grant: {
        Args: {
          target_actor_id: string
          target_grant_id: string
          target_lecture_session_id: string
          target_nonce_hash: string
          target_operations: Json
        }
        Returns: Json
      }
      admin_create_lecture: {
        Args: {
          lecture_code: string
          lecture_code_hash: string
          lecture_ends_at?: string
          lecture_starts_at?: string
          lecture_title: string
        }
        Returns: string
      }
      admin_create_lecture_v2: {
        Args: {
          lecture_code: string
          lecture_code_hash: string
          lecture_ends_at?: string
          lecture_starts_at?: string
          lecture_title: string
        }
        Returns: string
      }
      admin_create_pdf_publication_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_allowed_origin: string
          target_client_request_id: string
          target_declared_page_count: number
          target_declared_text_char_count: number
          target_declared_text_sha256: string
          target_display_name: string
          target_document_id: string
          target_download_enabled: boolean
          target_expected_byte_size: number
          target_expected_pdf_sha256: string
          target_lecture_session_id: string
          target_nonce_hash: string
          target_ticket_jti_hash: string
        }
        Returns: Json
      }
      admin_create_phase727_journal_club_run_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_client_request_id: string
          target_lecture_code: string
          target_lecture_code_hash: string
          target_run_kind: string
        }
        Returns: Json
      }
      admin_create_poll: {
        Args: {
          option_labels: string[]
          poll_question: string
          poll_type: string
          target_lecture_session_id: string
        }
        Returns: string
      }
      admin_duplicate_lecture_v1: {
        Args: {
          lecture_code: string
          lecture_code_hash: string
          source_lecture_session_id: string
        }
        Returns: string
      }
      admin_fail_academic_answer_operation: {
        Args: {
          actual_input_tokens: number
          actual_microusd: number
          actual_output_tokens: number
          provider_request_id: string
          target_actor_id: string
          target_error_code: string
          target_operation_id: string
          target_request_id: string
        }
        Returns: Json
      }
      admin_fail_material_ai_operation: {
        Args: {
          actual_input_tokens: number
          actual_microusd: number
          actual_output_tokens: number
          error_code: string
          provider_request_id: string
          target_actor_id: string
          target_operation_id: string
          target_status: string
        }
        Returns: Json
      }
      admin_fail_realtime_provider_call_creation: {
        Args: {
          target_actor_id: string
          target_error: string
          target_operation_id: string
        }
        Returns: boolean
      }
      admin_fail_summary_window_operation: {
        Args: {
          actual_input_tokens: number
          actual_microusd: number
          actual_output_tokens: number
          provider_request_id: string
          target_actor_id: string
          target_error_code: string
          target_operation_id: string
          target_run_id: string
        }
        Returns: Json
      }
      admin_find_inflight_pdf_publication_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_finish_lecture_ai_operation: {
        Args: {
          actual_audio_seconds?: number
          actual_input_tokens?: number
          actual_microusd?: number
          actual_output_tokens?: number
          error_code?: string
          provider_request_id?: string
          target_operation_id: string
          target_status: string
        }
        Returns: Json
      }
      admin_finish_realtime_caption_operation: {
        Args: {
          charge_elapsed?: boolean
          disable_feature?: boolean
          target_actor_id: string
          target_operation_id: string
          target_reason: string
        }
        Returns: Json
      }
      admin_get_ai_master_authorization_status: {
        Args: {
          target_actor_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_get_lecture_operator_access_v1: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      admin_get_lecture_operator_comment_history_v1: {
        Args: {
          before_comment_id: string
          before_created_at: string
          history_limit?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_get_lecture_operator_snapshot_v1: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          include_hidden?: boolean
          known_caption_version?: number
          known_comments_version?: number
          known_lecture_version?: number
          known_likes_version?: number
          known_metrics_version?: number
          known_pdf_version?: number
          known_polls_version?: number
          known_summaries_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_get_lecture_operator_snapshot_v2: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          include_hidden?: boolean
          known_caption_version?: number
          known_comments_version?: number
          known_lecture_version?: number
          known_likes_version?: number
          known_metrics_version?: number
          known_pdf_version?: number
          known_polls_version?: number
          known_summaries_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_get_material_ai_operation_state: {
        Args: {
          target_actor_id: string
          target_feature: string
          target_idempotency_key: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_get_pdf_access_claims_v1: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      admin_get_pdf_publication_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_publication_id: string
        }
        Returns: Json
      }
      admin_get_phase6_summary_results: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      admin_heartbeat_realtime_caption_operation: {
        Args: { target_actor_id: string; target_operation_id: string }
        Returns: Json
      }
      admin_issue_ai_billing_grant: {
        Args: {
          pin_succeeded: boolean
          target_actions: string[]
          target_actor_id: string
          target_lecture_session_id: string
          target_nonce_hash: string
        }
        Returns: Json
      }
      admin_issue_ai_billing_grant_from_master: {
        Args: {
          target_actions: string[]
          target_actor_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
          target_nonce_hash: string
        }
        Returns: Json
      }
      admin_list_academic_answer_results: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      admin_list_material_ai_results: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      admin_manage_academic_answer_publication: {
        Args: {
          target_action: string
          target_actor_id: string
          target_answer_id: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_manage_summary_publication: {
        Args: {
          target_action: string
          target_actor_id: string
          target_body?: Json
          target_lecture_session_id: string
          target_pinned_order?: number
          target_pinned_until?: string
          target_reason?: string
          target_summary_id: string
        }
        Returns: Json
      }
      admin_mark_academic_answer_insufficient: {
        Args: {
          target_actor_id: string
          target_reason: string
          target_request_id: string
        }
        Returns: Json
      }
      admin_mark_academic_provider_dispatched: {
        Args: {
          target_actor_id: string
          target_operation_id: string
          target_request_id: string
        }
        Returns: boolean
      }
      admin_moderate_lecture_comment: {
        Args: {
          target_action: string
          target_actor_id: string
          target_comment_id: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_prepare_academic_answer_request: {
        Args: {
          target_actor_id: string
          target_idempotency_key: string
          target_lecture_session_id: string
          target_question: string
          target_question_sha256: string
          target_search_query_sha256: string
          target_source_kind: string
          target_source_summary_id: string
        }
        Returns: Json
      }
      admin_prepare_academic_answer_request_v2: {
        Args: {
          target_actor_id: string
          target_idempotency_key: string
          target_lecture_session_id: string
          target_question: string
          target_question_sha256: string
          target_search_query_sha256: string
          target_source_kind: string
          target_source_policy: string
          target_source_summary_id: string
        }
        Returns: Json
      }
      admin_prepare_auto_academic_answer_request: {
        Args: {
          target_actor_id: string
          target_idempotency_key: string
          target_lecture_session_id: string
          target_question: string
          target_question_sha256: string
          target_run_id: string
          target_run_token_hash: string
          target_search_query_sha256: string
          target_source_policy: string
          target_source_summary_id: string
        }
        Returns: Json
      }
      admin_prepare_pdf_publication_activation_v1: {
        Args: {
          target_activation_operation_id: string
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_publication_id: string
        }
        Returns: Json
      }
      admin_prepare_pdf_publication_commit_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_commit_operation_id: string
          target_publication_id: string
        }
        Returns: Json
      }
      admin_publish_lecture_caption: {
        Args: {
          target_actor_id: string
          target_language: string
          target_last_item_id: string
          target_lecture_session_id: string
          target_operation_id: string
          target_sequence: number
          target_text: string
        }
        Returns: Json
      }
      admin_reap_stale_academic_answer_operations: {
        Args: { job_limit?: number }
        Returns: number
      }
      admin_reap_stale_realtime_caption_operations: {
        Args: { batch_limit?: number; target_lecture_session_id: string }
        Returns: {
          operation_id: string
        }[]
      }
      admin_record_realtime_token_issue: {
        Args: {
          target_actor_id: string
          target_model_id: string
          target_operation_id: string
          target_outcome: string
          target_provider_request_id?: string
        }
        Returns: Json
      }
      admin_record_summary_window_language: {
        Args: {
          target_actor_id: string
          target_language_reason: string
          target_resolved_language: string
          target_run_id: string
          target_window_id: string
        }
        Returns: Json
      }
      admin_register_local_pdf_document_v2: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_byte_size: number
          target_display_name: string
          target_document_id: string
          target_document_version: string
          target_download_enabled: boolean
          target_expected_access_version: number
          target_lecture_session_id: string
          target_manifest_etag: string
          target_manifest_version: number
          target_page_count: number
          target_pdf_sha256: string
          target_text_char_count: number
          target_text_sha256: string
        }
        Returns: {
          archive_expires_at: string | null
          browser_publication_id: string | null
          byte_size: number
          created_at: string
          delete_after: string | null
          display_name: string
          document_id: string
          document_version: string
          download_enabled: boolean
          lecture_session_id: string
          local_manifest_etag: string | null
          manifest_version: number
          page_count: number
          pdf_sha256: string
          published_at: string
          retired_at: string | null
          text_char_count: number
          text_sha256: string
          updated_at: string
          visible: boolean
        }
        SetofOptions: {
          from: "*"
          to: "lecture_pdf_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_register_pdf_document: {
        Args: {
          target_byte_size: number
          target_display_name: string
          target_document_id: string
          target_document_version: string
          target_download_enabled?: boolean
          target_lecture_session_id: string
          target_manifest_version: number
          target_page_count: number
          target_pdf_sha256: string
          target_text_char_count: number
          target_text_sha256: string
        }
        Returns: {
          archive_expires_at: string | null
          browser_publication_id: string | null
          byte_size: number
          created_at: string
          delete_after: string | null
          display_name: string
          document_id: string
          document_version: string
          download_enabled: boolean
          lecture_session_id: string
          local_manifest_etag: string | null
          manifest_version: number
          page_count: number
          pdf_sha256: string
          published_at: string
          retired_at: string | null
          text_char_count: number
          text_sha256: string
          updated_at: string
          visible: boolean
        }
        SetofOptions: {
          from: "*"
          to: "lecture_pdf_documents"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_reissue_pdf_publication_ticket_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_nonce_hash: string
          target_publication_id: string
          target_ticket_jti_hash: string
        }
        Returns: Json
      }
      admin_reject_poll_proposal: {
        Args: {
          target_actor_id: string
          target_lecture_session_id: string
          target_proposal_id: string
        }
        Returns: boolean
      }
      admin_restore_lecture_archive: {
        Args: { target_actor_id?: string; target_lecture_session_id: string }
        Returns: Json
      }
      admin_resume_lecture_summary_run: {
        Args: {
          target_actor_id: string
          target_lecture_session_id: string
          target_run_token_hash: string
        }
        Returns: Json
      }
      admin_revise_academic_answer_publication: {
        Args: {
          target_actor_id: string
          target_answer_id: string
          target_body: Json
          target_lecture_session_id: string
          target_reason?: string
        }
        Returns: Json
      }
      admin_revoke_ai_master_authorization: {
        Args: {
          target_actor_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
          target_reason: string
        }
        Returns: Json
      }
      admin_revoke_lecture_resume_tokens: {
        Args: { target_actor_id: string; target_lecture_session_id: string }
        Returns: number
      }
      admin_set_lecture_status: {
        Args: {
          target_action: string
          target_lecture_session_id: string
          transition_at?: string
        }
        Returns: boolean
      }
      admin_set_lecture_summary_language: {
        Args: {
          target_actor_id: string
          target_lecture_session_id: string
          target_summary_language: string
        }
        Returns: Json
      }
      admin_set_material_summary_publication: {
        Args: {
          target_actor_id: string
          target_analysis_id: string
          target_body: Json
          target_lecture_session_id: string
          target_review_state: string
          target_visibility: string
        }
        Returns: Json
      }
      admin_set_poll_status: {
        Args: {
          target_lecture_session_id: string
          target_poll_id: string
          target_status: string
        }
        Returns: boolean
      }
      admin_skip_summary_window: {
        Args: {
          target_actor_id: string
          target_lecture_session_id: string
          target_prompt_version: string
          target_reason: string
          target_run_id: string
          target_run_token_hash: string
          target_source_coverage: Json
          target_source_hashes: Json
          target_window_index: number
        }
        Returns: Json
      }
      admin_start_academic_answer_operation: {
        Args: {
          estimated_input_tokens: number
          estimated_microusd: number
          estimated_output_tokens: number
          target_actor_id: string
          target_grant_id: string
          target_input_price_microusd_per_million: number
          target_model_id: string
          target_nonce_hash: string
          target_output_price_microusd_per_million: number
          target_prompt_version: string
          target_request_id: string
          target_source_set_sha256: string
          target_verified_primary_count: number
          target_verified_source_count: number
        }
        Returns: Json
      }
      admin_start_academic_answer_operation_v2: {
        Args: {
          estimated_input_tokens: number
          estimated_microusd: number
          estimated_output_tokens: number
          target_actor_id: string
          target_grant_id: string
          target_input_price_microusd_per_million: number
          target_model_id: string
          target_nonce_hash: string
          target_output_price_microusd_per_million: number
          target_prompt_version: string
          target_request_id: string
          target_resolved_source_route: string
          target_source_set_sha256: string
          target_verified_primary_count: number
          target_verified_source_count: number
        }
        Returns: Json
      }
      admin_start_auto_academic_answer_operation: {
        Args: {
          estimated_input_tokens: number
          estimated_microusd: number
          estimated_output_tokens: number
          target_actor_id: string
          target_input_price_microusd_per_million: number
          target_model_id: string
          target_output_price_microusd_per_million: number
          target_prompt_version: string
          target_request_id: string
          target_resolved_source_route: string
          target_run_id: string
          target_run_token_hash: string
          target_source_set_sha256: string
          target_verified_primary_count: number
          target_verified_source_count: number
        }
        Returns: Json
      }
      admin_start_lecture_ai_operation: {
        Args: {
          estimated_audio_seconds?: number
          estimated_input_tokens?: number
          estimated_microusd?: number
          estimated_output_tokens?: number
          target_actor_id?: string
          target_feature: string
          target_idempotency_key: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      admin_start_lecture_summary_run: {
        Args: {
          target_actor_id: string
          target_grant_id: string
          target_grant_nonce_hash: string
          target_lecture_session_id: string
          target_run_token_hash: string
        }
        Returns: Json
      }
      admin_start_lecture_summary_run_v2: {
        Args: {
          target_academic_source_policy: string
          target_actor_id: string
          target_auto_academic_answers_enabled: boolean
          target_grant_id: string
          target_grant_nonce_hash: string
          target_lecture_session_id: string
          target_run_token_hash: string
        }
        Returns: Json
      }
      admin_start_material_ai_operation: {
        Args: {
          estimated_input_tokens: number
          estimated_microusd: number
          estimated_output_tokens: number
          target_actor_id: string
          target_analysis_id: string
          target_document_id: string
          target_document_version: string
          target_feature: string
          target_grant_id: string
          target_idempotency_key: string
          target_input_price_microusd_per_million: number
          target_lecture_session_id: string
          target_max_output_tokens: number
          target_model_id: string
          target_nonce_hash: string
          target_output_price_microusd_per_million: number
          target_page_end: number
          target_page_start: number
          target_prompt_version: string
          target_text_sha256: string
        }
        Returns: Json
      }
      admin_start_summary_window_operation: {
        Args: {
          estimated_input_tokens: number
          estimated_microusd: number
          estimated_output_tokens: number
          input_price_microusd_per_million: number
          output_price_microusd_per_million: number
          target_actor_id: string
          target_lecture_session_id: string
          target_model_id: string
          target_prompt_version: string
          target_run_id: string
          target_run_token_hash: string
          target_source_coverage: Json
          target_source_hashes: Json
          target_window_index: number
        }
        Returns: Json
      }
      admin_stop_lecture_ai_control: {
        Args: {
          target_actor_id?: string
          target_lecture_session_id: string
          target_reason: string
        }
        Returns: Json
      }
      admin_stop_lecture_summary_run: {
        Args: {
          target_actor_id: string
          target_lecture_session_id: string
          target_reason: string
        }
        Returns: Json
      }
      admin_update_pdf_display: {
        Args: {
          target_current_pdf_page: number
          target_display_mode: string
          target_lecture_session_id: string
          target_pdf_document_id: string
        }
        Returns: {
          current_pdf_page: number
          display_mode: string
          display_version: number
          lecture_session_id: string
          pdf_document_id: string
          state_version: number
          updated_at: string
        }[]
      }
      admin_update_pdf_display_phase2: {
        Args: {
          target_current_pdf_page: number
          target_display_mode: string
          target_lecture_session_id: string
          target_pdf_document_id: string
        }
        Returns: {
          current_pdf_page: number
          display_mode: string
          display_version: number
          lecture_session_id: string
          pdf_document_id: string
          state_version: number
          updated_at: string
        }[]
      }
      admin_update_pdf_display_v3: {
        Args: {
          target_current_pdf_page: number
          target_display_mode: string
          target_lecture_session_id: string
          target_pdf_document_id: string
          target_pdf_document_version: string
          target_pdf_manifest_version: number
          target_pdf_page_count: number
          target_pdf_visible: boolean
        }
        Returns: {
          current_pdf_page: number
          display_mode: string
          display_version: number
          lecture_session_id: string
          pdf_document_id: string
          pdf_document_version: string
          pdf_manifest_version: number
          pdf_page_count: number
          pdf_version: number
          pdf_visible: boolean
          state_version: number
          updated_at: string
        }[]
      }
      admin_update_pdf_display_with_presenter_fence_v1: {
        Args: {
          target_current_pdf_page: number
          target_display_mode: string
          target_lecture_session_id: string
          target_pdf_document_id: string
          target_pdf_document_version: string
          target_pdf_manifest_version: number
          target_pdf_page_count: number
          target_pdf_visible: boolean
        }
        Returns: {
          current_pdf_page: number
          display_mode: string
          display_version: number
          lecture_session_id: string
          pdf_document_id: string
          pdf_document_version: string
          pdf_manifest_version: number
          pdf_page_count: number
          pdf_version: number
          pdf_visible: boolean
          state_version: number
          updated_at: string
        }[]
      }
      apply_presenter_page_v1: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_event_id: string
          target_installation_hash: string
          target_pdf_page: number
          target_pptx_file_sha256: string
          target_sequence: number
          target_slide_id: number
          target_slide_id_order_sha256: string
          target_slide_index: number
        }
        Returns: Json
      }
      apply_presenter_page_v2: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_event_id: string
          target_global_bucket_hash: string
          target_installation_hash: string
          target_network_bucket_hash: string
          target_nonce_hash: string
          target_pdf_page: number
          target_pptx_file_sha256: string
          target_proof_key_bucket_hash: string
          target_proof_key_id: string
          target_proof_public_key_spki: string
          target_request_body_sha256: string
          target_request_issued_at: string
          target_sequence: number
          target_slide_id: number
          target_slide_id_order_sha256: string
          target_slide_index: number
        }
        Returns: Json
      }
      claim_daily_operations_digest_jobs: {
        Args: { job_limit: number; target_recipient: string }
        Returns: {
          attempt_count: number
          digest_date: string
          id: string
          recipient: string
        }[]
      }
      claim_display_caption_relay_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_lecture_session_id: string
          target_sequence: number
          target_source: string
          target_stream_id: string
          target_topic: string
        }
        Returns: string
      }
      claim_display_realtime_session_v1: {
        Args: {
          target_display_auth_user_id: string
          target_lecture_session_id: string
          target_token_jti_hash: string
        }
        Returns: Json
      }
      claim_due_pdf_publication_cleanup_v1: {
        Args: { job_limit?: number; target_worker_id?: string }
        Returns: Json[]
      }
      claim_lecture_archive_exports: {
        Args: { job_limit?: number }
        Returns: {
          archive_expires_at: string
          attempt_count: number
          lecture_code: string
          lecture_session_id: string
          payload: Json
          source_version: number
        }[]
      }
      claim_presenter_connection_v1: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_credential_hash: string
          target_credential_kind: string
          target_installation_hash: string
        }
        Returns: Json
      }
      claim_presenter_connection_v2: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_credential_hash: string
          target_credential_kind: string
          target_global_bucket_hash: string
          target_installation_hash: string
          target_network_bucket_hash: string
          target_nonce_hash: string
          target_proof_key_bucket_hash: string
          target_proof_key_id: string
          target_proof_public_key_spki: string
          target_request_body_sha256: string
          target_request_issued_at: string
        }
        Returns: Json
      }
      claim_realtime_provider_hangups: {
        Args: {
          job_limit?: number
          target_lecture_session_id?: string
          target_operation_id?: string
        }
        Returns: {
          attempt_count: number
          lecture_session_id: string
          operation_id: string
          provider_call_id: string
        }[]
      }
      cleanup_display_realtime_sessions_v1: { Args: never; Returns: number }
      cleanup_presenter_connections_v1: {
        Args: { target_limit?: number }
        Returns: number
      }
      cleanup_presenter_security_v2: {
        Args: { target_limit?: number }
        Returns: Json
      }
      complete_pdf_publication_cleanup_v1: {
        Args: {
          target_cleanup_claim_id: string
          target_error_code: string
          target_publication_id: string
          target_succeeded: boolean
          target_worker_id?: string
        }
        Returns: Json
      }
      confirm_presenter_connection_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_connection_id: string
        }
        Returns: Json
      }
      consume_admin_pin_rate_limit: {
        Args: {
          global_bucket_hash: string
          network_bucket_hash: string
          user_bucket_hash: string
        }
        Returns: Json
      }
      disconnect_presenter_connection_v1: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_installation_hash: string
        }
        Returns: Json
      }
      disconnect_presenter_connection_v2: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_global_bucket_hash: string
          target_installation_hash: string
          target_network_bucket_hash: string
          target_nonce_hash: string
          target_proof_key_bucket_hash: string
          target_proof_key_id: string
          target_proof_public_key_spki: string
          target_request_body_sha256: string
          target_request_issued_at: string
        }
        Returns: Json
      }
      finish_daily_operations_digest_job: {
        Args: {
          target_error_message?: string
          target_job_id: string
          target_provider_message_id?: string
          target_status: string
        }
        Returns: boolean
      }
      finish_lecture_archive_export: {
        Args: {
          target_error?: string
          target_lecture_session_id: string
          target_payload_sha256?: string
          target_source_version: number
          target_succeeded: boolean
        }
        Returns: boolean
      }
      finish_realtime_provider_hangup: {
        Args: {
          target_error?: string
          target_operation_id: string
          target_succeeded: boolean
        }
        Returns: boolean
      }
      get_lecture_archive_v2: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      get_lecture_archive_v3: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      get_lecture_archive_v4: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      get_lecture_comment_history_v2: {
        Args: {
          before_comment_id: string
          before_created_at: string
          history_limit?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_comment_history_v3: {
        Args: {
          before_comment_id?: string
          before_created_at?: string
          history_limit?: number
          history_scope?: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_live_snapshot: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          known_comments_version?: number
          known_display_version?: number
          known_likes_version?: number
          known_polls_version?: number
          known_state_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_participant_state_v2: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      get_lecture_public_snapshot_v2: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          known_caption_version?: number
          known_comments_version?: number
          known_lecture_version?: number
          known_likes_version?: number
          known_pdf_version?: number
          known_polls_version?: number
          known_summaries_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_public_snapshot_v3: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          known_caption_version?: number
          known_comments_version?: number
          known_lecture_version?: number
          known_likes_version?: number
          known_pdf_version?: number
          known_polls_version?: number
          known_summaries_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_public_snapshot_v4: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          known_caption_version?: number
          known_comments_version?: number
          known_lecture_version?: number
          known_likes_version?: number
          known_pdf_version?: number
          known_polls_version?: number
          known_summaries_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_public_snapshot_v5: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          known_caption_version?: number
          known_comments_version?: number
          known_lecture_version?: number
          known_likes_version?: number
          known_metrics_version?: number
          known_pdf_version?: number
          known_polls_version?: number
          known_summaries_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_public_snapshot_v6: {
        Args: {
          comment_cursor_created_at?: string
          comment_cursor_id?: string
          comment_limit?: number
          known_caption_version?: number
          known_comments_version?: number
          known_lecture_version?: number
          known_likes_version?: number
          known_metrics_version?: number
          known_pdf_version?: number
          known_polls_version?: number
          known_summaries_version?: number
          target_lecture_session_id: string
        }
        Returns: Json
      }
      get_lecture_resume_claim: {
        Args: { target_auth_user_id: string; target_lecture_session_id: string }
        Returns: Json
      }
      get_lecture_session_state: {
        Args: { target_lecture_session_id: string }
        Returns: {
          ends_at: string
          lecture_session_id: string
          starts_at: string
          status: string
          title: string
        }[]
      }
      get_lecture_terminal_state_v2: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      get_open_poll_results: {
        Args: { target_lecture_session_id: string }
        Returns: {
          option_id: string
          poll_id: string
          response_count: number
        }[]
      }
      get_pdf_access_claims_v1: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      get_presenter_connection_status_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
        }
        Returns: Json
      }
      heartbeat_presenter_connection_v1: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_installation_hash: string
          target_pptx_file_sha256: string
          target_slide_id_order_sha256: string
        }
        Returns: Json
      }
      heartbeat_presenter_connection_v2: {
        Args: {
          target_capability_jti_hash: string
          target_connection_id: string
          target_global_bucket_hash: string
          target_installation_hash: string
          target_network_bucket_hash: string
          target_nonce_hash: string
          target_pptx_file_sha256: string
          target_proof_key_bucket_hash: string
          target_proof_key_id: string
          target_proof_public_key_spki: string
          target_request_body_sha256: string
          target_request_issued_at: string
          target_slide_id_order_sha256: string
        }
        Returns: Json
      }
      inspect_presenter_connection_v1: {
        Args: {
          target_connection_id: string
          target_credential_hash: string
          target_credential_kind: string
          target_custom_show_active: boolean
          target_hidden_slide_count: number
          target_installation_hash: string
          target_pptx_file_sha256: string
          target_slide_count: number
          target_slide_id_order_sha256: string
        }
        Returns: Json
      }
      inspect_presenter_connection_v2: {
        Args: {
          target_connection_id: string
          target_credential_hash: string
          target_credential_kind: string
          target_custom_show_active: boolean
          target_global_bucket_hash: string
          target_hidden_slide_count: number
          target_installation_hash: string
          target_network_bucket_hash: string
          target_nonce_hash: string
          target_pptx_file_sha256: string
          target_proof_key_bucket_hash: string
          target_proof_key_id: string
          target_proof_public_key_spki: string
          target_request_body_sha256: string
          target_request_issued_at: string
          target_slide_count: number
          target_slide_id_order_sha256: string
        }
        Returns: Json
      }
      is_lecture_open: {
        Args: { target_lecture_session_id: string }
        Returns: boolean
      }
      is_poll_open: { Args: { target_poll_id: string }; Returns: boolean }
      issue_presenter_connection_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
          target_manual_code_hmac: string
          target_ticket_expires_at: string
          target_ticket_jti_hash: string
        }
        Returns: Json
      }
      issue_presenter_connection_v2: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
          target_manual_code_expires_at: string
          target_manual_code_hmac: string
          target_pairing_ticket_expires_at: string
          target_ticket_jti_hash: string
        }
        Returns: Json
      }
      join_lecture_by_code: {
        Args: { lecture_code: string }
        Returns: {
          ends_at: string
          lecture_session_id: string
          participant_id: string
          starts_at: string
          status: string
          title: string
        }[]
      }
      join_lecture_by_code_v2: {
        Args: { lecture_code: string }
        Returns: {
          ends_at: string
          lecture_session_id: string
          participant_id: string
          starts_at: string
          status: string
          title: string
        }[]
      }
      mark_realtime_provider_creation_uncertain: {
        Args: {
          target_actor_id: string
          target_error: string
          target_operation_id: string
        }
        Returns: boolean
      }
      participant_belongs_to_lecture: {
        Args: {
          target_lecture_session_id: string
          target_participant_id: string
        }
        Returns: boolean
      }
      record_realtime_provider_client_request: {
        Args: {
          target_actor_id: string
          target_client_request_id: string
          target_operation_id: string
        }
        Returns: boolean
      }
      register_display_realtime_session_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_lecture_session_id: string
          target_session_id: string
          target_token_expires_at: string
          target_token_jti_hash: string
        }
        Returns: Json
      }
      reset_admin_pin_rate_limit: {
        Args: { network_bucket_hash?: string; user_bucket_hash: string }
        Returns: undefined
      }
      revoke_presenter_connection_v1: {
        Args: {
          target_admin_auth_user_id: string
          target_admin_session_id: string
          target_connection_id: string
          target_reason?: string
        }
        Returns: Json
      }
      run_phase6_6_maintenance: { Args: never; Returns: Json }
      service_drain_ai_master_authorizations: {
        Args: { target_reason?: string }
        Returns: Json
      }
      set_display_realtime_runtime_v1: {
        Args: { target_enabled: boolean }
        Returns: number
      }
      set_presenter_runtime_v1: {
        Args: { target_enabled: boolean }
        Returns: Json
      }
      verify_and_touch_admin_session: {
        Args: {
          target_pin_version_hash: string
          target_session_id: string
          target_token_hash: string
        }
        Returns: Json
      }
      verify_display_realtime_session_v1: {
        Args: {
          target_display_auth_user_id: string
          target_lecture_session_id: string
          target_token_jti_hash: string
        }
        Returns: boolean
      }
      verify_display_snapshot_fallback_v1: {
        Args: {
          target_display_auth_user_id: string
          target_lecture_session_id: string
          target_token_jti_hash: string
        }
        Returns: boolean
      }
      worker_claim_pdf_publication_nonce_v1: {
        Args: {
          target_allowed_origin: string
          target_document_id: string
          target_expected_byte_size: number
          target_expected_pdf_sha256: string
          target_lecture_public_id: string
          target_nonce_hash: string
          target_publication_id: string
          target_ticket_admin_session_id: string
          target_ticket_generation: number
          target_ticket_jti_hash: string
          target_worker_attempt_id: string
        }
        Returns: Json
      }
      worker_record_pdf_publication_uploaded_v1: {
        Args: {
          target_actual_byte_size: number
          target_actual_pdf_sha256: string
          target_object_etag: string
          target_object_key: string
          target_pdf_magic_verified: boolean
          target_publication_id: string
          target_r2_object_version: string
          target_worker_attempt_id: string
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
