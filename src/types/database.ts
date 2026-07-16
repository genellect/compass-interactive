export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
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
  public: {
    Tables: {
      ai_usage_ledger: {
        Row: {
          actual_audio_seconds: number | null
          actual_input_tokens: number | null
          actual_microusd: number | null
          actual_output_tokens: number | null
          error_code: string | null
          feature: string
          finished_at: string | null
          id: string
          idempotency_key: string
          lecture_session_id: string
          provider_request_id: string | null
          requested_at: string
          requested_by_actor: string
          reserved_audio_seconds: number
          reserved_input_tokens: number
          reserved_microusd: number
          reserved_output_tokens: number
          result_accepted: boolean
          status: string
        }
        Insert: {
          actual_audio_seconds?: number | null
          actual_input_tokens?: number | null
          actual_microusd?: number | null
          actual_output_tokens?: number | null
          error_code?: string | null
          feature: string
          finished_at?: string | null
          id?: string
          idempotency_key: string
          lecture_session_id: string
          provider_request_id?: string | null
          requested_at?: string
          requested_by_actor: string
          reserved_audio_seconds?: number
          reserved_input_tokens?: number
          reserved_microusd?: number
          reserved_output_tokens?: number
          result_accepted?: boolean
          status?: string
        }
        Update: {
          actual_audio_seconds?: number | null
          actual_input_tokens?: number | null
          actual_microusd?: number | null
          actual_output_tokens?: number | null
          error_code?: string | null
          feature?: string
          finished_at?: string | null
          id?: string
          idempotency_key?: string
          lecture_session_id?: string
          provider_request_id?: string | null
          requested_at?: string
          requested_by_actor?: string
          reserved_audio_seconds?: number
          reserved_input_tokens?: number
          reserved_microusd?: number
          reserved_output_tokens?: number
          result_accepted?: boolean
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: 'ai_usage_ledger_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
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
            foreignKeyName: 'comment_like_totals_comment_id_lecture_session_id_fkey'
            columns: ['comment_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'comments'
            referencedColumns: ['id', 'lecture_session_id']
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
            foreignKeyName: 'comment_likes_comment_id_lecture_session_id_fkey'
            columns: ['comment_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'comments'
            referencedColumns: ['id', 'lecture_session_id']
          },
          {
            foreignKeyName: 'comment_likes_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comment_likes_participant_id_lecture_session_id_fkey'
            columns: ['participant_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'participants'
            referencedColumns: ['id', 'lecture_session_id']
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
            foreignKeyName: 'comments_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'comments_participant_id_lecture_session_id_fkey'
            columns: ['participant_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'participants'
            referencedColumns: ['id', 'lecture_session_id']
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
            foreignKeyName: 'lecture_admin_codes_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: true
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
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
          updated_at?: string
          used_microusd?: number
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: 'lecture_ai_control_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: true
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
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
            foreignKeyName: 'lecture_archive_state_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: true
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
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
            foreignKeyName: 'lecture_display_state_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: true
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
        ]
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
            foreignKeyName: 'lecture_lifecycle_events_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
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
          lecture_session_id: string
          lecture_version: number
          likes_version: number
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
        }
        Insert: {
          caption_version?: number
          comments_version?: number
          current_pdf_page?: number
          display_mode?: string
          display_version?: number
          lecture_session_id: string
          lecture_version?: number
          likes_version?: number
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
        }
        Update: {
          caption_version?: number
          comments_version?: number
          current_pdf_page?: number
          display_mode?: string
          display_version?: number
          lecture_session_id?: string
          lecture_version?: number
          likes_version?: number
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
        }
        Relationships: [
          {
            foreignKeyName: 'lecture_live_state_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: true
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
        ]
      }
      lecture_pdf_documents: {
        Row: {
          archive_expires_at: string | null
          byte_size: number
          created_at: string
          delete_after: string | null
          display_name: string
          document_id: string
          document_version: string
          download_enabled: boolean
          lecture_session_id: string
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
          byte_size: number
          created_at?: string
          delete_after?: string | null
          display_name: string
          document_id: string
          document_version: string
          download_enabled?: boolean
          lecture_session_id: string
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
          byte_size?: number
          created_at?: string
          delete_after?: string | null
          display_name?: string
          document_id?: string
          document_version?: string
          download_enabled?: boolean
          lecture_session_id?: string
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
            foreignKeyName: 'lecture_pdf_documents_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
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
          ends_at: string | null
          hard_stop_at: string | null
          id: string
          lifecycle_version: number
          pdf_access_version: number
          pdf_public_id: string
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
          ends_at?: string | null
          hard_stop_at?: string | null
          id?: string
          lifecycle_version?: number
          pdf_access_version?: number
          pdf_public_id?: string
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
          ends_at?: string | null
          hard_stop_at?: string | null
          id?: string
          lifecycle_version?: number
          pdf_access_version?: number
          pdf_public_id?: string
          started_at?: string | null
          starts_at?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
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
            foreignKeyName: 'participants_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
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
            foreignKeyName: 'poll_option_totals_option_id_poll_id_fkey'
            columns: ['option_id', 'poll_id']
            isOneToOne: false
            referencedRelation: 'poll_options'
            referencedColumns: ['id', 'poll_id']
          },
          {
            foreignKeyName: 'poll_option_totals_poll_id_lecture_session_id_fkey'
            columns: ['poll_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'polls'
            referencedColumns: ['id', 'lecture_session_id']
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
            foreignKeyName: 'poll_options_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'poll_options_poll_id_lecture_session_id_fkey'
            columns: ['poll_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'polls'
            referencedColumns: ['id', 'lecture_session_id']
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
            foreignKeyName: 'poll_responses_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'poll_responses_participant_id_lecture_session_id_fkey'
            columns: ['participant_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'participants'
            referencedColumns: ['id', 'lecture_session_id']
          },
          {
            foreignKeyName: 'poll_responses_poll_id_lecture_session_id_fkey'
            columns: ['poll_id', 'lecture_session_id']
            isOneToOne: false
            referencedRelation: 'polls'
            referencedColumns: ['id', 'lecture_session_id']
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
            foreignKeyName: 'poll_result_refresh_events_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'poll_result_refresh_events_poll_id_fkey'
            columns: ['poll_id']
            isOneToOne: false
            referencedRelation: 'polls'
            referencedColumns: ['id']
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
            foreignKeyName: 'polls_lecture_session_id_fkey'
            columns: ['lecture_session_id']
            isOneToOne: false
            referencedRelation: 'lecture_sessions'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_configure_lecture_ai_control: {
        Args: {
          configuration: Json
          target_actor_id?: string
          target_lecture_session_id: string
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
      admin_create_poll: {
        Args: {
          option_labels: string[]
          poll_question: string
          poll_type: string
          target_lecture_session_id: string
        }
        Returns: string
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
      admin_get_pdf_access_claims_v1: {
        Args: { target_lecture_session_id: string }
        Returns: Json
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
          byte_size: number
          created_at: string
          delete_after: string | null
          display_name: string
          document_id: string
          document_version: string
          download_enabled: boolean
          lecture_session_id: string
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
          from: '*'
          to: 'lecture_pdf_documents'
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_restore_lecture_archive: {
        Args: { target_actor_id?: string; target_lecture_session_id: string }
        Returns: Json
      }
      admin_set_lecture_status: {
        Args: {
          target_action: string
          target_lecture_session_id: string
          transition_at?: string
        }
        Returns: boolean
      }
      admin_set_poll_status: {
        Args: {
          target_lecture_session_id: string
          target_poll_id: string
          target_status: string
        }
        Returns: boolean
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
      admin_stop_lecture_ai_control: {
        Args: {
          target_actor_id?: string
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
      get_lecture_archive_v2: {
        Args: { target_lecture_session_id: string }
        Returns: Json
      }
      get_lecture_archive_v3: {
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
      is_lecture_open: {
        Args: { target_lecture_session_id: string }
        Returns: boolean
      }
      is_poll_open: { Args: { target_poll_id: string }; Returns: boolean }
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
      participant_belongs_to_lecture: {
        Args: {
          target_lecture_session_id: string
          target_participant_id: string
        }
        Returns: boolean
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] &
        DefaultSchema['Views'])
    ? (DefaultSchema['Tables'] &
        DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
    ? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
    ? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema['CompositeTypes']
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
    ? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
