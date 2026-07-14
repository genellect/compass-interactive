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
    PostgrestVersion: '14.5'
  }
  public: {
    Tables: {
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
      lecture_live_state: {
        Row: {
          caption_version: number
          comments_version: number
          current_pdf_page: number
          display_mode: string
          display_version: number
          lecture_version: number
          lecture_session_id: string
          likes_version: number
          pdf_document_id: string | null
          pdf_version: number
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
          lecture_version?: number
          lecture_session_id: string
          likes_version?: number
          pdf_document_id?: string | null
          pdf_version?: number
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
          lecture_version?: number
          lecture_session_id?: string
          likes_version?: number
          pdf_document_id?: string | null
          pdf_version?: number
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
      lecture_sessions: {
        Row: {
          code_hash: string
          created_at: string
          ends_at: string | null
          id: string
          starts_at: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          code_hash: string
          created_at?: string
          ends_at?: string | null
          id?: string
          starts_at?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          code_hash?: string
          created_at?: string
          ends_at?: string | null
          id?: string
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
      admin_update_pdf_display: {
        Args: {
          target_current_pdf_page: number
          target_display_mode: string
          target_lecture_session_id: string
          target_pdf_document_id: string | null
        }
        Returns: {
          current_pdf_page: number
          display_mode: string
          display_version: number
          lecture_session_id: string
          pdf_document_id: string | null
          state_version: number
          updated_at: string
        }[]
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
      get_lecture_participant_state_v2: {
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
      get_open_poll_results: {
        Args: { target_lecture_session_id: string }
        Returns: {
          option_id: string
          poll_id: string
          response_count: number
        }[]
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
  public: {
    Enums: {},
  },
} as const
