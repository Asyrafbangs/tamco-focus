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
      admin_security_log: {
        Row: {
          actor_email: string | null
          actor_employee_id: string | null
          actor_user_id: string | null
          detail: Json
          event_type: Database["public"]["Enums"]["audit_event_type"]
          id: string
          occurred_at: string
          subject_email: string | null
          subject_employee_id: string | null
          subject_user_id: string | null
          summary: string
        }
        Insert: {
          actor_email?: string | null
          actor_employee_id?: string | null
          actor_user_id?: string | null
          detail?: Json
          event_type: Database["public"]["Enums"]["audit_event_type"]
          id?: string
          occurred_at?: string
          subject_email?: string | null
          subject_employee_id?: string | null
          subject_user_id?: string | null
          summary: string
        }
        Update: {
          actor_email?: string | null
          actor_employee_id?: string | null
          actor_user_id?: string | null
          detail?: Json
          event_type?: Database["public"]["Enums"]["audit_event_type"]
          id?: string
          occurred_at?: string
          subject_email?: string | null
          subject_employee_id?: string | null
          subject_user_id?: string | null
          summary?: string
        }
        Relationships: []
      }
      attachment_views: {
        Row: {
          attachment_id: string
          id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          attachment_id: string
          id?: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          attachment_id?: string
          id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachment_views_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          byte_size: number
          checklist_item_id: string | null
          checksum_sha256: string | null
          created_at: string
          file_name: string
          id: string
          is_evidence: boolean
          mime_type: string
          storage_bucket: string
          storage_path: string
          task_id: string
          update_id: string | null
          uploaded_by: string
          virus_scan_state: string
        }
        Insert: {
          byte_size: number
          checklist_item_id?: string | null
          checksum_sha256?: string | null
          created_at?: string
          file_name: string
          id?: string
          is_evidence?: boolean
          mime_type: string
          storage_bucket?: string
          storage_path: string
          task_id: string
          update_id?: string | null
          uploaded_by: string
          virus_scan_state?: string
        }
        Update: {
          byte_size?: number
          checklist_item_id?: string | null
          checksum_sha256?: string | null
          created_at?: string
          file_name?: string
          id?: string
          is_evidence?: boolean
          mime_type?: string
          storage_bucket?: string
          storage_path?: string
          task_id?: string
          update_id?: string | null
          uploaded_by?: string
          virus_scan_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "attachments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "attachments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "attachments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "task_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_id: string | null
          bucket: Database["public"]["Enums"]["focus_bucket"] | null
          count_after: number | null
          count_before: number | null
          detail: Json
          event_type: Database["public"]["Enums"]["audit_event_type"]
          goal_id: string | null
          id: string
          new_status: Database["public"]["Enums"]["task_status"] | null
          occurred_at: string
          over_target: boolean | null
          previous_status: Database["public"]["Enums"]["task_status"] | null
          reason_code: Database["public"]["Enums"]["activation_reason"] | null
          reason_note: string | null
          reversal_of_event_id: string | null
          subject_user_id: string | null
          target_at_event: number | null
          task_id: string | null
          task_version: number | null
        }
        Insert: {
          actor_id?: string | null
          bucket?: Database["public"]["Enums"]["focus_bucket"] | null
          count_after?: number | null
          count_before?: number | null
          detail?: Json
          event_type: Database["public"]["Enums"]["audit_event_type"]
          goal_id?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["task_status"] | null
          occurred_at?: string
          over_target?: boolean | null
          previous_status?: Database["public"]["Enums"]["task_status"] | null
          reason_code?: Database["public"]["Enums"]["activation_reason"] | null
          reason_note?: string | null
          reversal_of_event_id?: string | null
          subject_user_id?: string | null
          target_at_event?: number | null
          task_id?: string | null
          task_version?: number | null
        }
        Update: {
          actor_id?: string | null
          bucket?: Database["public"]["Enums"]["focus_bucket"] | null
          count_after?: number | null
          count_before?: number | null
          detail?: Json
          event_type?: Database["public"]["Enums"]["audit_event_type"]
          goal_id?: string | null
          id?: string
          new_status?: Database["public"]["Enums"]["task_status"] | null
          occurred_at?: string
          over_target?: boolean | null
          previous_status?: Database["public"]["Enums"]["task_status"] | null
          reason_code?: Database["public"]["Enums"]["activation_reason"] | null
          reason_note?: string | null
          reversal_of_event_id?: string | null
          subject_user_id?: string | null
          target_at_event?: number | null
          task_id?: string | null
          task_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_reversal_of_event_id_fkey"
            columns: ["reversal_of_event_id"]
            isOneToOne: false
            referencedRelation: "audit_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "audit_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      barrier_responses: {
        Row: {
          author_id: string
          barrier_id: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["barrier_response_kind"]
          message: string
        }
        Insert: {
          author_id: string
          barrier_id: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["barrier_response_kind"]
          message: string
        }
        Update: {
          author_id?: string
          barrier_id?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["barrier_response_kind"]
          message?: string
        }
        Relationships: [
          {
            foreignKeyName: "barrier_responses_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barrier_responses_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barrier_responses_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barrier_responses_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barrier_responses_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barrier_responses_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "action_requests_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barrier_responses_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "barriers"
            referencedColumns: ["id"]
          },
        ]
      }
      barriers: {
        Row: {
          action_pending: boolean
          action_required_from: string | null
          action_type: Database["public"]["Enums"]["barrier_action_type"]
          add_to_meeting_queue: boolean
          description: string
          goal_id: string | null
          id: string
          impact: Database["public"]["Enums"]["barrier_impact"]
          raised_at: string
          raised_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_active: boolean
          source_inactive_at: string | null
          status: Database["public"]["Enums"]["barrier_status"]
          support_needed: string
          task_id: string | null
          version: number
        }
        Insert: {
          action_pending?: boolean
          action_required_from?: string | null
          action_type?: Database["public"]["Enums"]["barrier_action_type"]
          add_to_meeting_queue?: boolean
          description: string
          goal_id?: string | null
          id?: string
          impact: Database["public"]["Enums"]["barrier_impact"]
          raised_at?: string
          raised_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_active?: boolean
          source_inactive_at?: string | null
          status?: Database["public"]["Enums"]["barrier_status"]
          support_needed: string
          task_id?: string | null
          version?: number
        }
        Update: {
          action_pending?: boolean
          action_required_from?: string | null
          action_type?: Database["public"]["Enums"]["barrier_action_type"]
          add_to_meeting_queue?: boolean
          description?: string
          goal_id?: string | null
          id?: string
          impact?: Database["public"]["Enums"]["barrier_impact"]
          raised_at?: string
          raised_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_active?: boolean
          source_inactive_at?: string | null
          status?: Database["public"]["Enums"]["barrier_status"]
          support_needed?: string
          task_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_event_participants: {
        Row: {
          event_id: string
          user_id: string
        }
        Insert: {
          event_id: string
          user_id: string
        }
        Update: {
          event_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_event_participants_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "calendar_event_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_event_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "calendar_event_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      calendar_events: {
        Row: {
          barrier_id: string | null
          cancelled_at: string | null
          created_at: string
          created_by: string
          ends_at: string
          external_event_id: string | null
          id: string
          last_synced_at: string | null
          provider: string | null
          source_id: string | null
          source_type: string
          starts_at: string
          sync_status: string | null
          task_id: string | null
          title: string
        }
        Insert: {
          barrier_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by: string
          ends_at: string
          external_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: string | null
          source_id?: string | null
          source_type?: string
          starts_at: string
          sync_status?: string | null
          task_id?: string | null
          title: string
        }
        Update: {
          barrier_id?: string | null
          cancelled_at?: string | null
          created_at?: string
          created_by?: string
          ends_at?: string
          external_event_id?: string | null
          id?: string
          last_synced_at?: string | null
          provider?: string | null
          source_id?: string | null
          source_type?: string
          starts_at?: string
          sync_status?: string | null
          task_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "calendar_events_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "action_requests_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "barriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "calendar_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "calendar_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "calendar_events_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      completion_reviews: {
        Row: {
          decided_at: string | null
          decision: Database["public"]["Enums"]["review_decision"] | null
          decision_note: string | null
          id: string
          reviewer_id: string | null
          second_decided_at: string | null
          second_decision: Database["public"]["Enums"]["review_decision"] | null
          second_reviewer_id: string | null
          submitted_at: string
          submitted_by: string
          task_id: string
        }
        Insert: {
          decided_at?: string | null
          decision?: Database["public"]["Enums"]["review_decision"] | null
          decision_note?: string | null
          id?: string
          reviewer_id?: string | null
          second_decided_at?: string | null
          second_decision?:
            | Database["public"]["Enums"]["review_decision"]
            | null
          second_reviewer_id?: string | null
          submitted_at?: string
          submitted_by: string
          task_id: string
        }
        Update: {
          decided_at?: string | null
          decision?: Database["public"]["Enums"]["review_decision"] | null
          decision_note?: string | null
          id?: string
          reviewer_id?: string | null
          second_decided_at?: string | null
          second_decision?:
            | Database["public"]["Enums"]["review_decision"]
            | null
          second_reviewer_id?: string | null
          submitted_at?: string
          submitted_by?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "completion_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "completion_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "completion_reviews_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_second_reviewer_id_fkey"
            columns: ["second_reviewer_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "completion_reviews_second_reviewer_id_fkey"
            columns: ["second_reviewer_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_second_reviewer_id_fkey"
            columns: ["second_reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_second_reviewer_id_fkey"
            columns: ["second_reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "completion_reviews_second_reviewer_id_fkey"
            columns: ["second_reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "completion_reviews_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "completion_reviews_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "completion_reviews_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "completion_reviews_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      current_focus: {
        Row: {
          checklist_item_id: string | null
          confirmed_at: string
          created_at: string
          selected_at: string
          task_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          checklist_item_id?: string | null
          confirmed_at?: string
          created_at?: string
          selected_at?: string
          task_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          checklist_item_id?: string | null
          confirmed_at?: string
          created_at?: string
          selected_at?: string
          task_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "current_focus_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "current_focus_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "current_focus_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      delegations: {
        Row: {
          created_at: string
          created_by: string
          delegate_id: string
          delegator_id: string
          ends_at: string
          id: string
          reason: string
          starts_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          delegate_id: string
          delegator_id: string
          ends_at: string
          id?: string
          reason: string
          starts_at: string
        }
        Update: {
          created_at?: string
          created_by?: string
          delegate_id?: string
          delegator_id?: string
          ends_at?: string
          id?: string
          reason?: string
          starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "delegations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "delegations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "delegations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "delegations_delegate_id_fkey"
            columns: ["delegate_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "delegations_delegator_id_fkey"
            columns: ["delegator_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      departments: {
        Row: {
          code: string
          created_at: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      email_deliveries: {
        Row: {
          attempt_count: number
          body_html: string
          body_text: string
          id: string
          last_error: string | null
          next_retry_at: string | null
          period_end: string
          period_start: string
          processing_started_at: string | null
          queued_at: string
          recipient_email: string
          recipient_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["email_delivery_status"]
          subject: string
          summary_type: Database["public"]["Enums"]["email_summary_type"]
        }
        Insert: {
          attempt_count?: number
          body_html: string
          body_text: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          period_end: string
          period_start: string
          processing_started_at?: string | null
          queued_at?: string
          recipient_email: string
          recipient_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject: string
          summary_type: Database["public"]["Enums"]["email_summary_type"]
        }
        Update: {
          attempt_count?: number
          body_html?: string
          body_text?: string
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          period_end?: string
          period_start?: string
          processing_started_at?: string | null
          queued_at?: string
          recipient_email?: string
          recipient_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject?: string
          summary_type?: Database["public"]["Enums"]["email_summary_type"]
        }
        Relationships: [
          {
            foreignKeyName: "email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_goal_plans: {
        Row: {
          created_at: string
          employee_id: string
          finalized_at: string | null
          finalized_by: string | null
          id: string
          performance_period_id: string
          status: Database["public"]["Enums"]["goal_plan_status"]
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          employee_id: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          performance_period_id: string
          status?: Database["public"]["Enums"]["goal_plan_status"]
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          employee_id?: string
          finalized_at?: string | null
          finalized_by?: string | null
          id?: string
          performance_period_id?: string
          status?: Database["public"]["Enums"]["goal_plan_status"]
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_performance_period_id_fkey"
            columns: ["performance_period_id"]
            isOneToOne: false
            referencedRelation: "performance_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_targets: {
        Row: {
          bucket: Database["public"]["Enums"]["focus_bucket"]
          change_reason: string | null
          changed_by: string | null
          created_at: string
          effective_from: string
          id: string
          recommended_target: number
          scope_id: string | null
          scope_type: Database["public"]["Enums"]["focus_target_scope"]
        }
        Insert: {
          bucket: Database["public"]["Enums"]["focus_bucket"]
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          recommended_target: number
          scope_id?: string | null
          scope_type: Database["public"]["Enums"]["focus_target_scope"]
        }
        Update: {
          bucket?: Database["public"]["Enums"]["focus_bucket"]
          change_reason?: string | null
          changed_by?: string | null
          created_at?: string
          effective_from?: string
          id?: string
          recommended_target?: number
          scope_id?: string | null
          scope_type?: Database["public"]["Enums"]["focus_target_scope"]
        }
        Relationships: [
          {
            foreignKeyName: "focus_targets_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "focus_targets_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_targets_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "focus_targets_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "focus_targets_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_agreements: {
        Row: {
          agreed_at: string
          agreed_by: string
          detail: Json
          employee_id: string
          goal_id: string
          goal_version_id: string
          id: string
          manager_id: string
        }
        Insert: {
          agreed_at?: string
          agreed_by: string
          detail?: Json
          employee_id: string
          goal_id: string
          goal_version_id: string
          id?: string
          manager_id: string
        }
        Update: {
          agreed_at?: string
          agreed_by?: string
          detail?: Json
          employee_id?: string
          goal_id?: string
          goal_version_id?: string
          id?: string
          manager_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_agreements_agreed_by_fkey"
            columns: ["agreed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_agreements_agreed_by_fkey"
            columns: ["agreed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_agreed_by_fkey"
            columns: ["agreed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_agreed_by_fkey"
            columns: ["agreed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_agreements_agreed_by_fkey"
            columns: ["agreed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_agreements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_agreements_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_goal_version_id_fkey"
            columns: ["goal_version_id"]
            isOneToOne: true
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_agreements_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_agreements_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_agreements_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_attachment_views: {
        Row: {
          attachment_id: string
          id: string
          viewed_at: string
          viewer_id: string
        }
        Insert: {
          attachment_id: string
          id?: string
          viewed_at?: string
          viewer_id: string
        }
        Update: {
          attachment_id?: string
          id?: string
          viewed_at?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_attachment_views_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: false
            referencedRelation: "goal_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_attachment_views_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_attachments: {
        Row: {
          byte_size: number
          checksum_sha256: string | null
          created_at: string
          file_name: string
          goal_id: string
          goal_update_id: string | null
          id: string
          milestone_update_id: string | null
          mime_type: string
          storage_bucket: string
          storage_path: string
          uploaded_by: string
          virus_scan_state: string
        }
        Insert: {
          byte_size: number
          checksum_sha256?: string | null
          created_at?: string
          file_name: string
          goal_id: string
          goal_update_id?: string | null
          id?: string
          milestone_update_id?: string | null
          mime_type: string
          storage_bucket?: string
          storage_path: string
          uploaded_by: string
          virus_scan_state?: string
        }
        Update: {
          byte_size?: number
          checksum_sha256?: string | null
          created_at?: string
          file_name?: string
          goal_id?: string
          goal_update_id?: string | null
          id?: string
          milestone_update_id?: string | null
          mime_type?: string
          storage_bucket?: string
          storage_path?: string
          uploaded_by?: string
          virus_scan_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_attachments_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachments_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachments_goal_update_id_fkey"
            columns: ["goal_update_id"]
            isOneToOne: false
            referencedRelation: "goal_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachments_milestone_update_id_fkey"
            columns: ["milestone_update_id"]
            isOneToOne: false
            referencedRelation: "goal_milestone_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_check_ins: {
        Row: {
          agreed_actions: string | null
          checkin_type: Database["public"]["Enums"]["goal_checkin_type"]
          created_at: string
          employee_summary: string | null
          finalized_at: string | null
          finalized_by: string | null
          goal_id: string
          goal_update_id: string | null
          goal_version_id: string
          id: string
          manager_completed_at: string | null
          manager_completed_by: string | null
          manager_discussion: string | null
          no_material_change: boolean
          period_end: string
          period_month: number | null
          period_quarter: number | null
          period_start: string
          period_year: number
          progress_status: Database["public"]["Enums"]["goal_health"] | null
          result_statement: string | null
          session_id: string | null
          source_snapshot: Json
          status: Database["public"]["Enums"]["goal_checkin_status"]
          submitted_at: string | null
          submitted_by: string | null
          support_details: string | null
          support_requested: boolean
          updated_at: string
          version: number
        }
        Insert: {
          agreed_actions?: string | null
          checkin_type: Database["public"]["Enums"]["goal_checkin_type"]
          created_at?: string
          employee_summary?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          goal_id: string
          goal_update_id?: string | null
          goal_version_id: string
          id?: string
          manager_completed_at?: string | null
          manager_completed_by?: string | null
          manager_discussion?: string | null
          no_material_change?: boolean
          period_end: string
          period_month?: number | null
          period_quarter?: number | null
          period_start: string
          period_year: number
          progress_status?: Database["public"]["Enums"]["goal_health"] | null
          result_statement?: string | null
          session_id?: string | null
          source_snapshot?: Json
          status?: Database["public"]["Enums"]["goal_checkin_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          support_details?: string | null
          support_requested?: boolean
          updated_at?: string
          version?: number
        }
        Update: {
          agreed_actions?: string | null
          checkin_type?: Database["public"]["Enums"]["goal_checkin_type"]
          created_at?: string
          employee_summary?: string | null
          finalized_at?: string | null
          finalized_by?: string | null
          goal_id?: string
          goal_update_id?: string | null
          goal_version_id?: string
          id?: string
          manager_completed_at?: string | null
          manager_completed_by?: string | null
          manager_discussion?: string | null
          no_material_change?: boolean
          period_end?: string
          period_month?: number | null
          period_quarter?: number | null
          period_start?: string
          period_year?: number
          progress_status?: Database["public"]["Enums"]["goal_health"] | null
          result_statement?: string | null
          session_id?: string | null
          source_snapshot?: Json
          status?: Database["public"]["Enums"]["goal_checkin_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          support_details?: string | null
          support_requested?: boolean
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_check_ins_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_check_ins_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_check_ins_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_goal_update_id_fkey"
            columns: ["goal_update_id"]
            isOneToOne: false
            referencedRelation: "goal_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_goal_version_id_fkey"
            columns: ["goal_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_manager_completed_by_fkey"
            columns: ["manager_completed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_check_ins_manager_completed_by_fkey"
            columns: ["manager_completed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_manager_completed_by_fkey"
            columns: ["manager_completed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_manager_completed_by_fkey"
            columns: ["manager_completed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_check_ins_manager_completed_by_fkey"
            columns: ["manager_completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "goal_checkin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "goal_session_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_check_ins_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_check_ins_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_check_ins_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_checkin_session_items: {
        Row: {
          attention_text: string | null
          created_at: string
          goal_id: string
          goal_version_id: string
          health: string
          id: string
          legacy_check_in_id: string | null
          session_id: string
          source_snapshot: Json
          support_details: string | null
          support_requested: boolean
          update_text: string | null
        }
        Insert: {
          attention_text?: string | null
          created_at?: string
          goal_id: string
          goal_version_id: string
          health: string
          id?: string
          legacy_check_in_id?: string | null
          session_id: string
          source_snapshot?: Json
          support_details?: string | null
          support_requested?: boolean
          update_text?: string | null
        }
        Update: {
          attention_text?: string | null
          created_at?: string
          goal_id?: string
          goal_version_id?: string
          health?: string
          id?: string
          legacy_check_in_id?: string | null
          session_id?: string
          source_snapshot?: Json
          support_details?: string | null
          support_requested?: boolean
          update_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_checkin_session_items_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_session_items_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_session_items_goal_version_id_fkey"
            columns: ["goal_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_session_items_legacy_check_in_id_fkey"
            columns: ["legacy_check_in_id"]
            isOneToOne: false
            referencedRelation: "goal_check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_session_items_legacy_check_in_id_fkey"
            columns: ["legacy_check_in_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["current_quarterly_checkin_id"]
          },
          {
            foreignKeyName: "goal_checkin_session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "goal_checkin_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_session_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "goal_session_overview"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_checkin_sessions: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          performance_period_id: string
          period_month: number | null
          period_quarter: number | null
          period_year: number
          reviewed_at: string | null
          reviewed_by: string | null
          session_kind: Database["public"]["Enums"]["goal_session_kind"]
          status: Database["public"]["Enums"]["goal_session_status"]
          submitted_at: string | null
          submitted_by: string | null
          summary: string | null
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          performance_period_id: string
          period_month?: number | null
          period_quarter?: number | null
          period_year: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_kind: Database["public"]["Enums"]["goal_session_kind"]
          status?: Database["public"]["Enums"]["goal_session_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          summary?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          performance_period_id?: string
          period_month?: number | null
          period_quarter?: number | null
          period_year?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          session_kind?: Database["public"]["Enums"]["goal_session_kind"]
          status?: Database["public"]["Enums"]["goal_session_status"]
          submitted_at?: string | null
          submitted_by?: string | null
          summary?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_performance_period_id_fkey"
            columns: ["performance_period_id"]
            isOneToOne: false
            referencedRelation: "performance_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_milestone_updates: {
        Row: {
          author_id: string
          comment: string | null
          created_at: string
          goal_id: string
          id: string
          marked_complete: boolean
          milestone_id: string
          new_progress: number
          previous_progress: number
        }
        Insert: {
          author_id: string
          comment?: string | null
          created_at?: string
          goal_id: string
          id?: string
          marked_complete?: boolean
          milestone_id: string
          new_progress: number
          previous_progress: number
        }
        Update: {
          author_id?: string
          comment?: string | null
          created_at?: string
          goal_id?: string
          id?: string
          marked_complete?: boolean
          milestone_id?: string
          new_progress?: number
          previous_progress?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_milestone_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "goal_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestone_updates_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["current_milestone_id"]
          },
        ]
      }
      goal_milestones: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          completion_definition: string
          created_at: string
          goal_version_id: string
          id: string
          last_update_at: string
          position: number
          progress_percent: number
          source_milestone_id: string | null
          title: string
          weight_percent: number
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          completion_definition: string
          created_at?: string
          goal_version_id: string
          id?: string
          last_update_at?: string
          position: number
          progress_percent?: number
          source_milestone_id?: string | null
          title: string
          weight_percent: number
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          completion_definition?: string
          created_at?: string
          goal_version_id?: string
          id?: string
          last_update_at?: string
          position?: number
          progress_percent?: number
          source_milestone_id?: string | null
          title?: string
          weight_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_milestones_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestones_goal_version_id_fkey"
            columns: ["goal_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestones_source_milestone_id_fkey"
            columns: ["source_milestone_id"]
            isOneToOne: false
            referencedRelation: "goal_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_milestones_source_milestone_id_fkey"
            columns: ["source_milestone_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["current_milestone_id"]
          },
        ]
      }
      goal_participants: {
        Row: {
          added_at: string
          added_by: string
          goal_id: string
          participant_role: string
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by: string
          goal_id: string
          participant_role: string
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string
          goal_id?: string
          participant_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_participants_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_participants_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_participants_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_participants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_success_measure_updates: {
        Row: {
          author_id: string
          check_in_id: string | null
          created_at: string
          goal_id: string
          id: string
          measure_id: string
          new_numeric: number | null
          new_state: Database["public"]["Enums"]["goal_measure_state"] | null
          note: string | null
          previous_numeric: number | null
          previous_state:
            | Database["public"]["Enums"]["goal_measure_state"]
            | null
        }
        Insert: {
          author_id: string
          check_in_id?: string | null
          created_at?: string
          goal_id: string
          id?: string
          measure_id: string
          new_numeric?: number | null
          new_state?: Database["public"]["Enums"]["goal_measure_state"] | null
          note?: string | null
          previous_numeric?: number | null
          previous_state?:
            | Database["public"]["Enums"]["goal_measure_state"]
            | null
        }
        Update: {
          author_id?: string
          check_in_id?: string | null
          created_at?: string
          goal_id?: string
          id?: string
          measure_id?: string
          new_numeric?: number | null
          new_state?: Database["public"]["Enums"]["goal_measure_state"] | null
          note?: string | null
          previous_numeric?: number | null
          previous_state?:
            | Database["public"]["Enums"]["goal_measure_state"]
            | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_success_measure_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "goal_check_ins"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_check_in_id_fkey"
            columns: ["check_in_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["current_quarterly_checkin_id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measure_updates_measure_id_fkey"
            columns: ["measure_id"]
            isOneToOne: false
            referencedRelation: "goal_success_measures"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_success_measures: {
        Row: {
          actual_recorded_at: string | null
          actual_recorded_by: string | null
          actual_result: string | null
          created_at: string
          current_numeric: number | null
          current_state:
            | Database["public"]["Enums"]["goal_measure_state"]
            | null
          description: string | null
          goal_version_id: string
          id: string
          label: string
          measure_type: Database["public"]["Enums"]["goal_measure_type"]
          optional_target_date: string | null
          period: string | null
          position: number
          source_measure_id: string | null
          target_numeric: number | null
          target_text: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          actual_recorded_at?: string | null
          actual_recorded_by?: string | null
          actual_result?: string | null
          created_at?: string
          current_numeric?: number | null
          current_state?:
            | Database["public"]["Enums"]["goal_measure_state"]
            | null
          description?: string | null
          goal_version_id: string
          id?: string
          label: string
          measure_type: Database["public"]["Enums"]["goal_measure_type"]
          optional_target_date?: string | null
          period?: string | null
          position: number
          source_measure_id?: string | null
          target_numeric?: number | null
          target_text?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          actual_recorded_at?: string | null
          actual_recorded_by?: string | null
          actual_result?: string | null
          created_at?: string
          current_numeric?: number | null
          current_state?:
            | Database["public"]["Enums"]["goal_measure_state"]
            | null
          description?: string | null
          goal_version_id?: string
          id?: string
          label?: string
          measure_type?: Database["public"]["Enums"]["goal_measure_type"]
          optional_target_date?: string | null
          period?: string | null
          position?: number
          source_measure_id?: string | null
          target_numeric?: number | null
          target_text?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_success_measures_actual_recorded_by_fkey"
            columns: ["actual_recorded_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_success_measures_actual_recorded_by_fkey"
            columns: ["actual_recorded_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measures_actual_recorded_by_fkey"
            columns: ["actual_recorded_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measures_actual_recorded_by_fkey"
            columns: ["actual_recorded_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_success_measures_actual_recorded_by_fkey"
            columns: ["actual_recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measures_goal_version_id_fkey"
            columns: ["goal_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_success_measures_source_measure_id_fkey"
            columns: ["source_measure_id"]
            isOneToOne: false
            referencedRelation: "goal_success_measures"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_support_requests: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          created_at: string
          details: string
          goal_id: string
          goal_update_id: string
          id: string
          manager_id: string | null
          requested_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          details: string
          goal_id: string
          goal_update_id: string
          id?: string
          manager_id?: string | null
          requested_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          created_at?: string
          details?: string
          goal_id?: string
          goal_update_id?: string
          id?: string
          manager_id?: string | null
          requested_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_support_requests_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_goal_update_id_fkey"
            columns: ["goal_update_id"]
            isOneToOne: true
            referencedRelation: "goal_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_support_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_support_requests_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_updates: {
        Row: {
          author_id: string
          created_at: string
          goal_id: string
          goal_version_id: string
          id: string
          kind: Database["public"]["Enums"]["goal_update_kind"]
          new_reported_progress: number
          next_step: string | null
          previous_reported_progress: number
          support_details: string | null
          support_requested: boolean
          what_changed: string
        }
        Insert: {
          author_id: string
          created_at?: string
          goal_id: string
          goal_version_id: string
          id?: string
          kind?: Database["public"]["Enums"]["goal_update_kind"]
          new_reported_progress: number
          next_step?: string | null
          previous_reported_progress: number
          support_details?: string | null
          support_requested?: boolean
          what_changed: string
        }
        Update: {
          author_id?: string
          created_at?: string
          goal_id?: string
          goal_version_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["goal_update_kind"]
          new_reported_progress?: number
          next_step?: string | null
          previous_reported_progress?: number
          support_details?: string | null
          support_requested?: boolean
          what_changed?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_updates_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_updates_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_updates_goal_version_id_fkey"
            columns: ["goal_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_versions: {
        Row: {
          activated_at: string | null
          baseline: string | null
          dependencies: string | null
          employee_approach: string | null
          expected_result: string
          goal_id: string
          id: string
          proposed_at: string
          proposed_by: string
          purpose: string | null
          status: Database["public"]["Enums"]["goal_version_status"]
          success_measure: string
          superseded_at: string | null
          support_agreed: string | null
          target_date: string
          title: string
          version: number
          version_number: number
          weight_percent: number
        }
        Insert: {
          activated_at?: string | null
          baseline?: string | null
          dependencies?: string | null
          employee_approach?: string | null
          expected_result: string
          goal_id: string
          id?: string
          proposed_at?: string
          proposed_by: string
          purpose?: string | null
          status?: Database["public"]["Enums"]["goal_version_status"]
          success_measure: string
          superseded_at?: string | null
          support_agreed?: string | null
          target_date: string
          title: string
          version?: number
          version_number: number
          weight_percent?: number
        }
        Update: {
          activated_at?: string | null
          baseline?: string | null
          dependencies?: string | null
          employee_approach?: string | null
          expected_result?: string
          goal_id?: string
          id?: string
          proposed_at?: string
          proposed_by?: string
          purpose?: string | null
          status?: Database["public"]["Enums"]["goal_version_status"]
          success_measure?: string
          superseded_at?: string | null
          support_agreed?: string | null
          target_date?: string
          title?: string
          version?: number
          version_number?: number
          weight_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "goal_versions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_versions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_versions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_versions_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_work_links: {
        Row: {
          created_at: string
          goal_id: string
          id: string
          linked_by: string
          milestone_id: string | null
          task_id: string
        }
        Insert: {
          created_at?: string
          goal_id: string
          id?: string
          linked_by: string
          milestone_id?: string | null
          task_id: string
        }
        Update: {
          created_at?: string
          goal_id?: string
          id?: string
          linked_by?: string
          milestone_id?: string | null
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "goal_work_links_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_work_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_work_links_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "goal_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["current_milestone_id"]
          },
          {
            foreignKeyName: "goal_work_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "goal_work_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_work_links_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          active_version_id: string | null
          agreed_at: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string
          checkin_due_at: string | null
          closed_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          final_result_summary: string | null
          governance_mode_at_activation:
            | Database["public"]["Enums"]["goal_governance_mode"]
            | null
          health: Database["public"]["Enums"]["goal_health"]
          id: string
          last_meaningful_update_at: string
          manager_id: string | null
          owner_id: string
          pending_version_id: string | null
          performance_period_id: string
          reported_progress: number
          status: Database["public"]["Enums"]["goal_status"]
          target_date: string
          title: string
          update_requested_at: string | null
          updated_at: string
          version: number
          weight_percent: number
        }
        Insert: {
          active_version_id?: string | null
          agreed_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string
          checkin_due_at?: string | null
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          final_result_summary?: string | null
          governance_mode_at_activation?:
            | Database["public"]["Enums"]["goal_governance_mode"]
            | null
          health?: Database["public"]["Enums"]["goal_health"]
          id?: string
          last_meaningful_update_at?: string
          manager_id?: string | null
          owner_id: string
          pending_version_id?: string | null
          performance_period_id: string
          reported_progress?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_date: string
          title: string
          update_requested_at?: string | null
          updated_at?: string
          version?: number
          weight_percent?: number
        }
        Update: {
          active_version_id?: string | null
          agreed_at?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string
          checkin_due_at?: string | null
          closed_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          final_result_summary?: string | null
          governance_mode_at_activation?:
            | Database["public"]["Enums"]["goal_governance_mode"]
            | null
          health?: Database["public"]["Enums"]["goal_health"]
          id?: string
          last_meaningful_update_at?: string
          manager_id?: string | null
          owner_id?: string
          pending_version_id?: string | null
          performance_period_id?: string
          reported_progress?: number
          status?: Database["public"]["Enums"]["goal_status"]
          target_date?: string
          title?: string
          update_requested_at?: string | null
          updated_at?: string
          version?: number
          weight_percent?: number
        }
        Relationships: [
          {
            foreignKeyName: "goals_active_version_fk"
            columns: ["active_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_cancelled_by_fkey"
            columns: ["cancelled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_pending_version_fk"
            columns: ["pending_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_performance_period_id_fkey"
            columns: ["performance_period_id"]
            isOneToOne: false
            referencedRelation: "performance_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_queue_items: {
        Row: {
          added_by: string | null
          barrier_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_due_at: string | null
          decision_owner_id: string | null
          id: string
          requested_by: string | null
          scheduled_event_id: string | null
          source: Database["public"]["Enums"]["meeting_item_source"]
          source_active: boolean
          source_inactive_at: string | null
          status: Database["public"]["Enums"]["meeting_item_status"]
          summary: string
          task_id: string | null
        }
        Insert: {
          added_by?: string | null
          barrier_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_due_at?: string | null
          decision_owner_id?: string | null
          id?: string
          requested_by?: string | null
          scheduled_event_id?: string | null
          source: Database["public"]["Enums"]["meeting_item_source"]
          source_active?: boolean
          source_inactive_at?: string | null
          status?: Database["public"]["Enums"]["meeting_item_status"]
          summary: string
          task_id?: string | null
        }
        Update: {
          added_by?: string | null
          barrier_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_due_at?: string | null
          decision_owner_id?: string | null
          id?: string
          requested_by?: string | null
          scheduled_event_id?: string | null
          source?: Database["public"]["Enums"]["meeting_item_source"]
          source_active?: boolean
          source_inactive_at?: string | null
          status?: Database["public"]["Enums"]["meeting_item_status"]
          summary?: string
          task_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_queue_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "action_requests_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "barriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decision_owner_id_fkey"
            columns: ["decision_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decision_owner_id_fkey"
            columns: ["decision_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decision_owner_id_fkey"
            columns: ["decision_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decision_owner_id_fkey"
            columns: ["decision_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_decision_owner_id_fkey"
            columns: ["decision_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_scheduled_event_id_fkey"
            columns: ["scheduled_event_id"]
            isOneToOne: false
            referencedRelation: "calendar_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "meeting_queue_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_queue_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_email_deliveries: {
        Row: {
          attempt_count: number
          body_html: string | null
          body_text: string | null
          id: string
          last_error: string | null
          next_retry_at: string | null
          notification_id: string
          processing_started_at: string | null
          queued_at: string
          recipient_email: string
          recipient_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["email_delivery_status"]
          subject: string | null
        }
        Insert: {
          attempt_count?: number
          body_html?: string | null
          body_text?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          notification_id: string
          processing_started_at?: string | null
          queued_at?: string
          recipient_email: string
          recipient_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject?: string | null
        }
        Update: {
          attempt_count?: number
          body_html?: string | null
          body_text?: string | null
          id?: string
          last_error?: string | null
          next_retry_at?: string | null
          notification_id?: string
          processing_started_at?: string | null
          queued_at?: string
          recipient_email?: string
          recipient_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["email_delivery_status"]
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_email_deliveries_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: true
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notification_email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notification_email_deliveries_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          actor_id: string | null
          barrier_id: string | null
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          dedupe_key: string | null
          entity_id: string | null
          entity_type: string | null
          goal_id: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          quiet: boolean
          read_at: string | null
          recipient_id: string
          requires_action: boolean
          task_id: string | null
          title: string
        }
        Insert: {
          actor_id?: string | null
          barrier_id?: string | null
          body: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          goal_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
          quiet?: boolean
          read_at?: string | null
          recipient_id: string
          requires_action?: boolean
          task_id?: string | null
          title: string
        }
        Update: {
          actor_id?: string | null
          barrier_id?: string | null
          body?: string
          channel?: Database["public"]["Enums"]["notification_channel"]
          created_at?: string
          dedupe_key?: string | null
          entity_id?: string | null
          entity_type?: string | null
          goal_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          quiet?: boolean
          read_at?: string | null
          recipient_id?: string
          requires_action?: boolean
          task_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "action_requests_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "barriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      operation_log: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          idempotency_key: string
          operation: string
          result: Json
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          idempotency_key: string
          operation: string
          result: Json
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          idempotency_key?: string
          operation?: string
          result?: Json
        }
        Relationships: [
          {
            foreignKeyName: "operation_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operation_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "operation_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "operation_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          description: string
          key: string
          manager_editable: boolean
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          description: string
          key: string
          manager_editable?: boolean
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          description?: string
          key?: string
          manager_editable?: boolean
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "org_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_settings_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      performance_periods: {
        Row: {
          created_at: string
          ends_on: string
          id: string
          name: string
          starts_on: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_on: string
          id?: string
          name: string
          starts_on: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_on?: string
          id?: string
          name?: string
          starts_on?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      routine_findings: {
        Row: {
          created_task_id: string | null
          description: string
          id: string
          occurrence_task_id: string
          recorded_at: string
          recorded_by: string
          severity: Database["public"]["Enums"]["finding_severity"]
        }
        Insert: {
          created_task_id?: string | null
          description: string
          id?: string
          occurrence_task_id: string
          recorded_at?: string
          recorded_by: string
          severity: Database["public"]["Enums"]["finding_severity"]
        }
        Update: {
          created_task_id?: string | null
          description?: string
          id?: string
          occurrence_task_id?: string
          recorded_at?: string
          recorded_by?: string
          severity?: Database["public"]["Enums"]["finding_severity"]
        }
        Relationships: [
          {
            foreignKeyName: "routine_findings_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "routine_findings_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_occurrence_task_id_fkey"
            columns: ["occurrence_task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_occurrence_task_id_fkey"
            columns: ["occurrence_task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "routine_findings_occurrence_task_id_fkey"
            columns: ["occurrence_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_occurrence_task_id_fkey"
            columns: ["occurrence_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_findings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_findings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_findings_recorded_by_fkey"
            columns: ["recorded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_occurrence_exceptions: {
        Row: {
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          raised_at: string
          raised_by: string
          reason_code: Database["public"]["Enums"]["routine_exception_reason"]
          reason_note: string | null
          state: Database["public"]["Enums"]["routine_exception_state"]
          task_id: string
          withdrawn_at: string | null
        }
        Insert: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          raised_at?: string
          raised_by: string
          reason_code: Database["public"]["Enums"]["routine_exception_reason"]
          reason_note?: string | null
          state?: Database["public"]["Enums"]["routine_exception_state"]
          task_id: string
          withdrawn_at?: string | null
        }
        Update: {
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          raised_at?: string
          raised_by?: string
          reason_code?: Database["public"]["Enums"]["routine_exception_reason"]
          reason_note?: string | null
          state?: Database["public"]["Enums"]["routine_exception_state"]
          task_id?: string
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_template_items: {
        Row: {
          action: string
          evidence_rule: Database["public"]["Enums"]["evidence_rule"]
          id: string
          position: number
          template_id: string
        }
        Insert: {
          action: string
          evidence_rule?: Database["public"]["Enums"]["evidence_rule"]
          id?: string
          position: number
          template_id: string
        }
        Update: {
          action?: string
          evidence_rule?: Database["public"]["Enums"]["evidence_rule"]
          id?: string
          position?: number
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "routine_template_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_template_items_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "routine_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_templates: {
        Row: {
          area: string | null
          completion_opens_days_before: number
          created_at: string
          created_by: string
          day_of_month: number | null
          default_owner_id: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_time: string
          ends_after_count: number | null
          ends_mode: string
          ends_on_date: string | null
          evidence_instruction: string | null
          evidence_required: boolean
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          generated_through: string | null
          id: string
          interval_count: number
          is_active: boolean
          month_of_year: number | null
          monthly_mode: string | null
          nth_weekday: number | null
          nth_weekday_dow: number | null
          occurrences_generated: number
          purged_at: string | null
          purged_by: string | null
          requires_completion_review: boolean
          start_date: string | null
          title: string
          updated_at: string
          weekday: number | null
          weekdays: number[] | null
          work_purpose: Database["public"]["Enums"]["work_purpose"] | null
        }
        Insert: {
          area?: string | null
          completion_opens_days_before?: number
          created_at?: string
          created_by: string
          day_of_month?: number | null
          default_owner_id: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_time?: string
          ends_after_count?: number | null
          ends_mode?: string
          ends_on_date?: string | null
          evidence_instruction?: string | null
          evidence_required?: boolean
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          generated_through?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          month_of_year?: number | null
          monthly_mode?: string | null
          nth_weekday?: number | null
          nth_weekday_dow?: number | null
          occurrences_generated?: number
          purged_at?: string | null
          purged_by?: string | null
          requires_completion_review?: boolean
          start_date?: string | null
          title: string
          updated_at?: string
          weekday?: number | null
          weekdays?: number[] | null
          work_purpose?: Database["public"]["Enums"]["work_purpose"] | null
        }
        Update: {
          area?: string | null
          completion_opens_days_before?: number
          created_at?: string
          created_by?: string
          day_of_month?: number | null
          default_owner_id?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_time?: string
          ends_after_count?: number | null
          ends_mode?: string
          ends_on_date?: string | null
          evidence_instruction?: string | null
          evidence_required?: boolean
          frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          generated_through?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          month_of_year?: number | null
          monthly_mode?: string | null
          nth_weekday?: number | null
          nth_weekday_dow?: number | null
          occurrences_generated?: number
          purged_at?: string | null
          purged_by?: string | null
          requires_completion_review?: boolean
          start_date?: string | null
          title?: string
          updated_at?: string
          weekday?: number | null
          weekdays?: number[] | null
          work_purpose?: Database["public"]["Enums"]["work_purpose"] | null
        }
        Relationships: [
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_checklist_items: {
        Row: {
          action: string
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          completion_note: string | null
          created_at: string
          depends_on_item_id: string | null
          due_at: string | null
          evidence_rule: Database["public"]["Enums"]["evidence_rule"]
          id: string
          position: number
          state: Database["public"]["Enums"]["checklist_item_state"]
          task_id: string
          updated_at: string
        }
        Insert: {
          action: string
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          created_at?: string
          depends_on_item_id?: string | null
          due_at?: string | null
          evidence_rule?: Database["public"]["Enums"]["evidence_rule"]
          id?: string
          position: number
          state?: Database["public"]["Enums"]["checklist_item_state"]
          task_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completion_note?: string | null
          created_at?: string
          depends_on_item_id?: string | null
          due_at?: string | null
          evidence_rule?: Database["public"]["Enums"]["evidence_rule"]
          id?: string
          position?: number
          state?: Database["public"]["Enums"]["checklist_item_state"]
          task_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_depends_on_item_id_fkey"
            columns: ["depends_on_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "task_checklist_items_depends_on_item_id_fkey"
            columns: ["depends_on_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "task_checklist_items_depends_on_item_id_fkey"
            columns: ["depends_on_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_collaborators: {
        Row: {
          added_by: string
          created_at: string
          id: string
          task_id: string
          user_id: string
        }
        Insert: {
          added_by: string
          created_at?: string
          id?: string
          task_id: string
          user_id: string
        }
        Update: {
          added_by?: string
          created_at?: string
          id?: string
          task_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_collaborators_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_collaborators_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_collaborators_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_collaborators_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_collaborators_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_relations: {
        Row: {
          created_at: string
          created_by: string
          id: string
          related_task_id: string
          relation: Database["public"]["Enums"]["relation_type"]
          task_id: string
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          related_task_id: string
          relation: Database["public"]["Enums"]["relation_type"]
          task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          related_task_id?: string
          relation?: Database["public"]["Enums"]["relation_type"]
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_relations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_relations_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_related_task_id_fkey"
            columns: ["related_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_relations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_relations_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      task_update_mentions: {
        Row: {
          update_id: string
          user_id: string
        }
        Insert: {
          update_id: string
          user_id: string
        }
        Update: {
          update_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_update_mentions_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "task_updates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_update_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_update_mentions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_updates: {
        Row: {
          author_id: string
          barrier_id: string | null
          body: string | null
          created_at: string
          id: string
          is_evidence_only: boolean
          is_meaningful: boolean
          task_id: string
        }
        Insert: {
          author_id: string
          barrier_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_evidence_only?: boolean
          is_meaningful?: boolean
          task_id: string
        }
        Update: {
          author_id?: string
          barrier_id?: string | null
          body?: string | null
          created_at?: string
          id?: string
          is_evidence_only?: boolean
          is_meaningful?: boolean
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_updates_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "action_requests_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_barrier_id_fkey"
            columns: ["barrier_id"]
            isOneToOne: false
            referencedRelation: "barriers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_updates_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          activation_reason_code:
            | Database["public"]["Enums"]["activation_reason"]
            | null
          activation_reason_note: string | null
          assigned_by: string | null
          assignment_batch_id: string | null
          cancelled_at: string | null
          classification_rule_code: string | null
          classification_rule_text: string | null
          completed_at: string | null
          completed_by: string | null
          completed_owner_id: string | null
          completion_evidence_instruction: string | null
          completion_evidence_rule: string
          created_at: string
          created_by: string
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_at: string | null
          due_is_date_only: boolean
          focus_bucket: Database["public"]["Enums"]["focus_bucket"] | null
          id: string
          is_mandatory: boolean
          last_meaningful_update_at: string
          mandatory_justification: string | null
          next_action: string | null
          occurrence_date: string | null
          origin: Database["public"]["Enums"]["work_origin"]
          over_focus_target: boolean
          paused_reason: string | null
          paused_restart_at: string | null
          primary_owner_id: string
          progress_percent: number
          purged_at: string | null
          purged_by: string | null
          review_at: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewer_id: string | null
          routine_area: string | null
          routine_completion_opens_on: string | null
          routine_template_id: string | null
          source_entity_id: string | null
          source_entity_type: string | null
          source_module: string | null
          state_entered_at: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"]
          version: number
          work_class: Database["public"]["Enums"]["work_class"]
          work_purpose: Database["public"]["Enums"]["work_purpose"] | null
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason_code?:
            | Database["public"]["Enums"]["activation_reason"]
            | null
          activation_reason_note?: string | null
          assigned_by?: string | null
          assignment_batch_id?: string | null
          cancelled_at?: string | null
          classification_rule_code?: string | null
          classification_rule_text?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_owner_id?: string | null
          completion_evidence_instruction?: string | null
          completion_evidence_rule?: string
          created_at?: string
          created_by: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          focus_bucket?: Database["public"]["Enums"]["focus_bucket"] | null
          id?: string
          is_mandatory?: boolean
          last_meaningful_update_at?: string
          mandatory_justification?: string | null
          next_action?: string | null
          occurrence_date?: string | null
          origin: Database["public"]["Enums"]["work_origin"]
          over_focus_target?: boolean
          paused_reason?: string | null
          paused_restart_at?: string | null
          primary_owner_id: string
          progress_percent?: number
          purged_at?: string | null
          purged_by?: string | null
          review_at?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewer_id?: string | null
          routine_area?: string | null
          routine_completion_opens_on?: string | null
          routine_template_id?: string | null
          source_entity_id?: string | null
          source_entity_type?: string | null
          source_module?: string | null
          state_entered_at?: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
          version?: number
          work_class: Database["public"]["Enums"]["work_class"]
          work_purpose?: Database["public"]["Enums"]["work_purpose"] | null
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason_code?:
            | Database["public"]["Enums"]["activation_reason"]
            | null
          activation_reason_note?: string | null
          assigned_by?: string | null
          assignment_batch_id?: string | null
          cancelled_at?: string | null
          classification_rule_code?: string | null
          classification_rule_text?: string | null
          completed_at?: string | null
          completed_by?: string | null
          completed_owner_id?: string | null
          completion_evidence_instruction?: string | null
          completion_evidence_rule?: string
          created_at?: string
          created_by?: string
          deleted_at?: string | null
          deleted_by?: string | null
          description?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          focus_bucket?: Database["public"]["Enums"]["focus_bucket"] | null
          id?: string
          is_mandatory?: boolean
          last_meaningful_update_at?: string
          mandatory_justification?: string | null
          next_action?: string | null
          occurrence_date?: string | null
          origin?: Database["public"]["Enums"]["work_origin"]
          over_focus_target?: boolean
          paused_reason?: string | null
          paused_restart_at?: string | null
          primary_owner_id?: string
          progress_percent?: number
          purged_at?: string | null
          purged_by?: string | null
          review_at?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewer_id?: string | null
          routine_area?: string | null
          routine_completion_opens_on?: string | null
          routine_template_id?: string | null
          source_entity_id?: string | null
          source_entity_type?: string | null
          source_module?: string | null
          state_entered_at?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
          version?: number
          work_class?: Database["public"]["Enums"]["work_class"]
          work_purpose?: Database["public"]["Enums"]["work_purpose"] | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_activated_by_fkey"
            columns: ["activated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_owner_id_fkey"
            columns: ["completed_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_completed_owner_id_fkey"
            columns: ["completed_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_owner_id_fkey"
            columns: ["completed_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_owner_id_fkey"
            columns: ["completed_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_completed_owner_id_fkey"
            columns: ["completed_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_routine_template_fk"
            columns: ["routine_template_id"]
            isOneToOne: false
            referencedRelation: "routine_template_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_routine_template_fk"
            columns: ["routine_template_id"]
            isOneToOne: false
            referencedRelation: "routine_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      user_alert_preferences: {
        Row: {
          assignment_changes: boolean
          barrier_involving_me: boolean
          collaboration_handoff: boolean
          due_today_and_deadlines: boolean
          routine_upcoming: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          assignment_changes?: boolean
          barrier_involving_me?: boolean
          collaboration_handoff?: boolean
          due_today_and_deadlines?: boolean
          routine_upcoming?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          assignment_changes?: boolean
          barrier_involving_me?: boolean
          collaboration_handoff?: boolean
          due_today_and_deadlines?: boolean
          routine_upcoming?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_alert_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_alert_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_alert_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_alert_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_alert_preferences_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          created_at: string
          daily_brief_hour: number
          daily_brief_mode: string
          deactivated_at: string | null
          default_landing_page: string
          department_id: string | null
          email: string
          employee_id: string
          first_day_of_week: number
          full_name: string
          id: string
          personal_summary_mode: Database["public"]["Enums"]["personal_summary_mode"]
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          reduced_motion: boolean
          reporting_manager_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          shortcut_hints: boolean
          status: Database["public"]["Enums"]["account_status"]
          status_labels_always_visible: boolean
          team_summary_mode: Database["public"]["Enums"]["team_summary_mode"]
          text_size: string
          theme_colors: Json | null
          theme_preference: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          daily_brief_hour?: number
          daily_brief_mode?: string
          deactivated_at?: string | null
          default_landing_page?: string
          department_id?: string | null
          email: string
          employee_id: string
          first_day_of_week?: number
          full_name: string
          id: string
          personal_summary_mode?: Database["public"]["Enums"]["personal_summary_mode"]
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          reduced_motion?: boolean
          reporting_manager_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          shortcut_hints?: boolean
          status?: Database["public"]["Enums"]["account_status"]
          status_labels_always_visible?: boolean
          team_summary_mode?: Database["public"]["Enums"]["team_summary_mode"]
          text_size?: string
          theme_colors?: Json | null
          theme_preference?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          daily_brief_hour?: number
          daily_brief_mode?: string
          deactivated_at?: string | null
          default_landing_page?: string
          department_id?: string | null
          email?: string
          employee_id?: string
          first_day_of_week?: number
          full_name?: string
          id?: string
          personal_summary_mode?: Database["public"]["Enums"]["personal_summary_mode"]
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          reduced_motion?: boolean
          reporting_manager_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          shortcut_hints?: boolean
          status?: Database["public"]["Enums"]["account_status"]
          status_labels_always_visible?: boolean
          team_summary_mode?: Database["public"]["Enums"]["team_summary_mode"]
          text_size?: string
          theme_colors?: Json | null
          theme_preference?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      visibility_grants: {
        Row: {
          created_at: string
          granted_by: string
          id: string
          reason: string | null
          subject_id: string
          viewer_id: string
        }
        Insert: {
          created_at?: string
          granted_by: string
          id?: string
          reason?: string | null
          subject_id: string
          viewer_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string
          id?: string
          reason?: string | null
          subject_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visibility_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_grants_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_grants_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_grants_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_grants_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_grants_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      visibility_policies: {
        Row: {
          created_at: string
          mode: Database["public"]["Enums"]["visibility_mode"]
          updated_at: string
          updated_by: string
          viewer_id: string
        }
        Insert: {
          created_at?: string
          mode?: Database["public"]["Enums"]["visibility_mode"]
          updated_at?: string
          updated_by: string
          viewer_id: string
        }
        Update: {
          created_at?: string
          mode?: Database["public"]["Enums"]["visibility_mode"]
          updated_at?: string
          updated_by?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "visibility_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_policies_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: true
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_policies_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: true
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_policies_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: true
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "visibility_policies_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: true
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "visibility_policies_viewer_id_fkey"
            columns: ["viewer_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_commitment_changes: {
        Row: {
          commitment_id: string
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          kind: Database["public"]["Enums"]["weekly_change_kind"]
          payload: Json
          reason: string
          requested_at: string
          requested_by: string
          state: Database["public"]["Enums"]["weekly_change_state"]
          updated_at: string
        }
        Insert: {
          commitment_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind: Database["public"]["Enums"]["weekly_change_kind"]
          payload?: Json
          reason: string
          requested_at?: string
          requested_by: string
          state?: Database["public"]["Enums"]["weekly_change_state"]
          updated_at?: string
        }
        Update: {
          commitment_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["weekly_change_kind"]
          payload?: Json
          reason?: string
          requested_at?: string
          requested_by?: string
          state?: Database["public"]["Enums"]["weekly_change_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_commitment_changes_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitment_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_commitment_events: {
        Row: {
          actor_id: string | null
          commitment_id: string
          created_at: string
          detail: Json
          id: string
          kind: string
          note: string | null
        }
        Insert: {
          actor_id?: string | null
          commitment_id: string
          created_at?: string
          detail?: Json
          id?: string
          kind: string
          note?: string | null
        }
        Update: {
          actor_id?: string | null
          commitment_id?: string
          created_at?: string
          detail?: Json
          id?: string
          kind?: string
          note?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "weekly_commitment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitment_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_events_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitment_events_commitment_id_fkey"
            columns: ["commitment_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitments"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_commitments: {
        Row: {
          carried_from_id: string | null
          checklist_item_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          employee_id: string
          expected_result: string
          id: string
          proposed_at: string
          proposed_by: string
          rank: number
          state: Database["public"]["Enums"]["weekly_commitment_state"]
          superseded_by_id: string | null
          target_date: string | null
          task_id: string
          updated_at: string
          version: number
          week_start: string
        }
        Insert: {
          carried_from_id?: string | null
          checklist_item_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id: string
          expected_result: string
          id?: string
          proposed_at?: string
          proposed_by: string
          rank?: number
          state?: Database["public"]["Enums"]["weekly_commitment_state"]
          superseded_by_id?: string | null
          target_date?: string | null
          task_id: string
          updated_at?: string
          version?: number
          week_start: string
        }
        Update: {
          carried_from_id?: string | null
          checklist_item_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          employee_id?: string
          expected_result?: string
          id?: string
          proposed_at?: string
          proposed_by?: string
          rank?: number
          state?: Database["public"]["Enums"]["weekly_commitment_state"]
          superseded_by_id?: string | null
          target_date?: string | null
          task_id?: string
          updated_at?: string
          version?: number
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "weekly_commitments_carried_from_id_fkey"
            columns: ["carried_from_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_carried_from_id_fkey"
            columns: ["carried_from_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "weekly_commitments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "weekly_commitments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      work_capture_attachments: {
        Row: {
          byte_size: number
          capture_id: string
          created_at: string
          file_name: string
          id: string
          mime_type: string
          storage_bucket: string
          storage_path: string
        }
        Insert: {
          byte_size: number
          capture_id: string
          created_at?: string
          file_name: string
          id?: string
          mime_type: string
          storage_bucket?: string
          storage_path: string
        }
        Update: {
          byte_size?: number
          capture_id?: string
          created_at?: string
          file_name?: string
          id?: string
          mime_type?: string
          storage_bucket?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_capture_attachments_capture_id_fkey"
            columns: ["capture_id"]
            isOneToOne: false
            referencedRelation: "work_captures"
            referencedColumns: ["id"]
          },
        ]
      }
      work_captures: {
        Row: {
          captured_by: string
          chosen_destination:
            | Database["public"]["Enums"]["capture_destination"]
            | null
          classification_rule_code: string | null
          classification_rule_text: string | null
          completion_evidence_instruction: string | null
          completion_evidence_rule: string
          created_at: string
          created_proposal_id: string | null
          created_task_id: string | null
          description: string | null
          due_at: string | null
          due_is_date_only: boolean
          expected_months: number | null
          followup_answer: string | null
          followup_question: string | null
          id: string
          parent_task_id: string | null
          recommendation_reason: string
          recommended_destination: Database["public"]["Enums"]["capture_destination"]
          resolved_at: string | null
          status: Database["public"]["Enums"]["capture_status"]
          success_measure: string | null
          timing_choice: string
          title: string
          urgency_question_answer: boolean | null
          urgency_question_asked: boolean
          work_purpose: Database["public"]["Enums"]["work_purpose"] | null
        }
        Insert: {
          captured_by: string
          chosen_destination?:
            | Database["public"]["Enums"]["capture_destination"]
            | null
          classification_rule_code?: string | null
          classification_rule_text?: string | null
          completion_evidence_instruction?: string | null
          completion_evidence_rule?: string
          created_at?: string
          created_proposal_id?: string | null
          created_task_id?: string | null
          description?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          expected_months?: number | null
          followup_answer?: string | null
          followup_question?: string | null
          id?: string
          parent_task_id?: string | null
          recommendation_reason: string
          recommended_destination: Database["public"]["Enums"]["capture_destination"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["capture_status"]
          success_measure?: string | null
          timing_choice: string
          title: string
          urgency_question_answer?: boolean | null
          urgency_question_asked?: boolean
          work_purpose?: Database["public"]["Enums"]["work_purpose"] | null
        }
        Update: {
          captured_by?: string
          chosen_destination?:
            | Database["public"]["Enums"]["capture_destination"]
            | null
          classification_rule_code?: string | null
          classification_rule_text?: string | null
          completion_evidence_instruction?: string | null
          completion_evidence_rule?: string
          created_at?: string
          created_proposal_id?: string | null
          created_task_id?: string | null
          description?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          expected_months?: number | null
          followup_answer?: string | null
          followup_question?: string | null
          id?: string
          parent_task_id?: string | null
          recommendation_reason?: string
          recommended_destination?: Database["public"]["Enums"]["capture_destination"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["capture_status"]
          success_measure?: string | null
          timing_choice?: string
          title?: string
          urgency_question_answer?: boolean | null
          urgency_question_asked?: boolean
          work_purpose?: Database["public"]["Enums"]["work_purpose"] | null
        }
        Relationships: [
          {
            foreignKeyName: "work_captures_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_captures_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_captures_captured_by_fkey"
            columns: ["captured_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_created_proposal_id_fkey"
            columns: ["created_proposal_id"]
            isOneToOne: false
            referencedRelation: "work_proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "work_captures_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "work_captures_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_captures_parent_task_id_fkey"
            columns: ["parent_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      work_proposals: {
        Row: {
          created_at: string
          created_task_id: string | null
          created_template_id: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          id: string
          kind: string
          last_submitted_at: string
          payload: Json
          proposed_by: string
          rationale: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          created_at?: string
          created_task_id?: string | null
          created_template_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind: string
          last_submitted_at?: string
          payload?: Json
          proposed_by: string
          rationale?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          created_at?: string
          created_task_id?: string | null
          created_template_id?: string | null
          decided_at?: string | null
          decided_by?: string | null
          decision_note?: string | null
          id?: string
          kind?: string
          last_submitted_at?: string
          payload?: Json
          proposed_by?: string
          rationale?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "work_proposals_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "work_proposals_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_created_task_id_fkey"
            columns: ["created_task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_created_template_id_fkey"
            columns: ["created_template_id"]
            isOneToOne: false
            referencedRelation: "routine_template_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_created_template_id_fkey"
            columns: ["created_template_id"]
            isOneToOne: false
            referencedRelation: "routine_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_proposals_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "work_proposals_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      action_requests_overview: {
        Row: {
          action_pending: boolean | null
          action_required_from: string | null
          action_required_from_name: string | null
          action_type: Database["public"]["Enums"]["barrier_action_type"] | null
          description: string | null
          goal_id: string | null
          id: string | null
          impact: Database["public"]["Enums"]["barrier_impact"] | null
          raised_at: string | null
          raised_by: string | null
          raised_by_name: string | null
          resolved_at: string | null
          source_active: boolean | null
          source_id: string | null
          source_inactive_at: string | null
          source_title: string | null
          source_type: string | null
          status: Database["public"]["Enums"]["barrier_status"] | null
          support_needed: string | null
          task_id: string | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_action_required_from_fkey"
            columns: ["action_required_from"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goal_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_goal_id_fkey"
            columns: ["goal_id"]
            isOneToOne: false
            referencedRelation: "goals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "barriers_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "barriers_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      binned_tasks: {
        Row: {
          deleted_at: string | null
          deleted_by: string | null
          deleted_by_name: string | null
          due_at: string | null
          due_is_date_only: boolean | null
          focus_bucket: Database["public"]["Enums"]["focus_bucket"] | null
          id: string | null
          owner_name: string | null
          primary_owner_id: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          title: string | null
          version: number | null
          work_class: Database["public"]["Enums"]["work_class"] | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      completed_contributions: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          checklist_item_id: string | null
          completed_at: string | null
          completed_by: string | null
          parent_status: Database["public"]["Enums"]["task_status"] | null
          parent_title: string | null
          parent_work_class: Database["public"]["Enums"]["work_class"] | null
          primary_owner_id: string | null
          primary_owner_name: string | null
          task_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      current_focus_overview: {
        Row: {
          checklist_item_id: string | null
          confirmed_at: string | null
          due_at: string | null
          due_is_date_only: boolean | null
          focus_title: string | null
          is_step: boolean | null
          primary_owner_id: string | null
          selected_at: string | null
          step_action: string | null
          task_id: string | null
          task_status: Database["public"]["Enums"]["task_status"] | null
          task_title: string | null
          user_id: string | null
          work_class: Database["public"]["Enums"]["work_class"] | null
        }
        Relationships: [
          {
            foreignKeyName: "current_focus_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "current_focus_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "current_focus_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "current_focus_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      focus_summary: {
        Row: {
          active_count: number | null
          bucket: Database["public"]["Enums"]["focus_bucket"] | null
          full_name: string | null
          is_over_target: boolean | null
          over_target_since: string | null
          recommended_target: number | null
          user_id: string | null
        }
        Relationships: []
      }
      goal_lifecycle_history: {
        Row: {
          actor_id: string | null
          actor_name: string | null
          detail: Json | null
          event_kind: string | null
          goal_id: string | null
          id: string | null
          occurred_at: string | null
          title: string | null
        }
        Relationships: []
      }
      goal_overview: {
        Row: {
          active_version_id: string | null
          active_version_number: number | null
          agreed_at: string | null
          attention_reason: string | null
          baseline: string | null
          category: string | null
          checkin_due_at: string | null
          closed_at: string | null
          completed_at: string | null
          created_at: string | null
          current_milestone_id: string | null
          current_milestone_progress: number | null
          current_milestone_title: string | null
          current_quarterly_checkin_id: string | null
          current_quarterly_status:
            | Database["public"]["Enums"]["goal_checkin_status"]
            | null
          dependencies: string | null
          derived_progress: number | null
          employee_approach: string | null
          expected_result: string | null
          has_recent_milestone_completion: boolean | null
          health: Database["public"]["Enums"]["goal_health"] | null
          id: string | null
          is_checkin_due: boolean | null
          is_monthly_checkin_due: boolean | null
          is_quarterly_checkin_due: boolean | null
          is_target_approaching: boolean | null
          is_update_requested: boolean | null
          last_meaningful_update_at: string | null
          last_monthly_checkin_at: string | null
          last_monthly_checkin_status:
            | Database["public"]["Enums"]["goal_health"]
            | null
          latest_year_end_result: string | null
          latest_year_end_status:
            | Database["public"]["Enums"]["goal_checkin_status"]
            | null
          manager_attention_reason: string | null
          manager_id: string | null
          manager_name: string | null
          manager_needs_attention: boolean | null
          measure_progress: number | null
          needs_attention: boolean | null
          next_milestone_title: string | null
          next_monthly_checkin_date: string | null
          next_quarterly_checkin_date: string | null
          open_support_count: number | null
          owner_employee_id: string | null
          owner_id: string | null
          owner_name: string | null
          pending_version_id: string | null
          purpose: string | null
          quarterly_requires_manager_action: boolean | null
          reported_progress: number | null
          reporting_manager_id: string | null
          status: Database["public"]["Enums"]["goal_status"] | null
          success_measure: string | null
          success_measure_count: number | null
          support_agreed: string | null
          target_date: string | null
          title: string | null
          update_requested_at: string | null
          version: number | null
          weight_percent: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_active_version_fk"
            columns: ["active_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_manager_id_fkey"
            columns: ["manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_pending_version_fk"
            columns: ["pending_version_id"]
            isOneToOne: false
            referencedRelation: "goal_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_plan_overview: {
        Row: {
          active_goal_count: number | null
          can_finalize: boolean | null
          employee_id: string | null
          employee_name: string | null
          ends_on: string | null
          finalized_at: string | null
          finalized_by: string | null
          formal_weight: number | null
          id: string | null
          performance_period_id: string | null
          performance_period_name: string | null
          reallocation_required: number | null
          starts_on: string | null
          status: Database["public"]["Enums"]["goal_plan_status"] | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "employee_goal_plans_finalized_by_fkey"
            columns: ["finalized_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_goal_plans_performance_period_id_fkey"
            columns: ["performance_period_id"]
            isOneToOne: false
            referencedRelation: "performance_periods"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_session_overview: {
        Row: {
          at_risk_count: number | null
          employee_id: string | null
          employee_name: string | null
          goal_count: number | null
          id: string | null
          off_track_count: number | null
          performance_period_id: string | null
          performance_period_name: string | null
          period_month: number | null
          period_quarter: number | null
          period_year: number | null
          reviewed_at: string | null
          reviewed_by: string | null
          reviewed_by_name: string | null
          session_kind: Database["public"]["Enums"]["goal_session_kind"] | null
          status: Database["public"]["Enums"]["goal_session_status"] | null
          submitted_at: string | null
          submitted_by: string | null
          submitted_by_name: string | null
          summary: string | null
          support_request_count: number | null
          version: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_performance_period_id_fkey"
            columns: ["performance_period_id"]
            isOneToOne: false
            referencedRelation: "performance_periods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goal_checkin_sessions_submitted_by_fkey"
            columns: ["submitted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      goal_team_summary: {
        Row: {
          active_goal_count: number | null
          attention_count: number | null
          checkin_due_count: number | null
          employee_id: string | null
          full_name: string | null
          last_goal_update_at: string | null
          quarterly_action_count: number | null
          quarterly_due_count: number | null
          support_request_count: number | null
          user_id: string | null
          weighted_progress: number | null
        }
        Relationships: [
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "goals_owner_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      person_display: {
        Row: {
          employee_id: string | null
          full_name: string | null
          id: string | null
        }
        Insert: {
          employee_id?: string | null
          full_name?: string | null
          id?: string | null
        }
        Update: {
          employee_id?: string | null
          full_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
      plan_events: {
        Row: {
          assignee_id: string | null
          assignee_name: string | null
          barrier_id: string | null
          can_reschedule: boolean | null
          due_is_date_only: boolean | null
          event_id: string | null
          event_kind: string | null
          occurs_at: string | null
          parent_due_at: string | null
          parent_title: string | null
          primary_owner_id: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          step_has_own_date: boolean | null
          step_id: string | null
          steps_due_with_task: number | null
          task_id: string | null
          task_version: number | null
          title: string | null
          work_class: Database["public"]["Enums"]["work_class"] | null
        }
        Relationships: []
      }
      routine_occurrence_outcomes: {
        Row: {
          cancelled_at: string | null
          completed_at: string | null
          decided_at: string | null
          decided_by: string | null
          decided_by_name: string | null
          decision_note: string | null
          exception_id: string | null
          exception_state:
            | Database["public"]["Enums"]["routine_exception_state"]
            | null
          occurrence_date: string | null
          outcome: string | null
          primary_owner_id: string | null
          raised_at: string | null
          raised_by: string | null
          raised_by_name: string | null
          reason_code:
            | Database["public"]["Enums"]["routine_exception_reason"]
            | null
          reason_note: string | null
          routine_template_id: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_occurrence_exceptions_raised_by_fkey"
            columns: ["raised_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_routine_template_fk"
            columns: ["routine_template_id"]
            isOneToOne: false
            referencedRelation: "routine_template_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_routine_template_fk"
            columns: ["routine_template_id"]
            isOneToOne: false
            referencedRelation: "routine_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_template_overview: {
        Row: {
          created_at: string | null
          created_by: string | null
          day_of_month: number | null
          default_owner_id: string | null
          deleted_at: string | null
          deleted_by: string | null
          description: string | null
          due_time: string | null
          ends_after_count: number | null
          ends_mode: string | null
          ends_on_date: string | null
          evidence_instruction: string | null
          evidence_required: boolean | null
          frequency: Database["public"]["Enums"]["recurrence_frequency"] | null
          generated_through: string | null
          id: string | null
          interval_count: number | null
          is_active: boolean | null
          month_of_year: number | null
          monthly_mode: string | null
          next_occurrence_date: string | null
          nth_weekday: number | null
          nth_weekday_dow: number | null
          occurrence_count: number | null
          owner_name: string | null
          purged_at: string | null
          purged_by: string | null
          requires_completion_review: boolean | null
          scheduled_next_date: string | null
          start_date: string | null
          title: string | null
          weekday: number | null
          weekdays: number[] | null
        }
        Relationships: [
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_default_owner_id_fkey"
            columns: ["default_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_deleted_by_fkey"
            columns: ["deleted_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "routine_templates_purged_by_fkey"
            columns: ["purged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_contributions: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_by_name: string | null
          assignee_id: string | null
          assignee_name: string | null
          checklist_item_id: string | null
          completed_at: string | null
          depends_on_item_id: string | null
          evidence_rule: Database["public"]["Enums"]["evidence_rule"] | null
          item_due_at: string | null
          parent_due_at: string | null
          parent_due_is_date_only: boolean | null
          parent_status: Database["public"]["Enums"]["task_status"] | null
          parent_title: string | null
          parent_work_class: Database["public"]["Enums"]["work_class"] | null
          position: number | null
          prerequisite_title: string | null
          primary_owner_id: string | null
          primary_owner_name: string | null
          readiness: string | null
          state: Database["public"]["Enums"]["checklist_item_state"] | null
          task_id: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_checklist_items_assigned_to_fkey"
            columns: ["assignee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_depends_on_item_id_fkey"
            columns: ["depends_on_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "task_checklist_items_depends_on_item_id_fkey"
            columns: ["depends_on_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "task_checklist_items_depends_on_item_id_fkey"
            columns: ["depends_on_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_checklist_items_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      task_overview: {
        Row: {
          activation_reason_code:
            | Database["public"]["Enums"]["activation_reason"]
            | null
          activation_reason_note: string | null
          assigned_by: string | null
          assigned_by_name: string | null
          assignment_batch_id: string | null
          attachment_count: number | null
          cancelled_at: string | null
          checklist_completed: number | null
          checklist_ready: number | null
          checklist_total: number | null
          classification_rule_code: string | null
          classification_rule_text: string | null
          collaborator_count: number | null
          completed_at: string | null
          completed_by: string | null
          completed_owner_id: string | null
          completion_evidence_instruction: string | null
          completion_evidence_rule: string | null
          created_at: string | null
          delegated_open_count: number | null
          delegated_overdue_count: number | null
          description: string | null
          due_at: string | null
          due_is_date_only: boolean | null
          evidence_count: number | null
          focus_bucket: Database["public"]["Enums"]["focus_bucket"] | null
          id: string | null
          is_mandatory: boolean | null
          is_overdue: boolean | null
          is_stale: boolean | null
          last_meaningful_update_at: string | null
          missing_evidence_count: number | null
          next_action: string | null
          next_delegated_due_at: string | null
          occurrence_date: string | null
          open_barrier_count: number | null
          origin: Database["public"]["Enums"]["work_origin"] | null
          over_focus_target: boolean | null
          owner_department_id: string | null
          owner_employee_id: string | null
          owner_name: string | null
          primary_owner_id: string | null
          progress_percent: number | null
          review_at: string | null
          review_status: Database["public"]["Enums"]["review_status"] | null
          reviewer_id: string | null
          routine_area: string | null
          routine_completion_opens_on: string | null
          routine_template_id: string | null
          state_entered_at: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          title: string | null
          urgency: Database["public"]["Enums"]["urgency_level"] | null
          version: number | null
          work_class: Database["public"]["Enums"]["work_class"] | null
          work_purpose: Database["public"]["Enums"]["work_purpose"] | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_completed_by_fkey"
            columns: ["completed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_reviewer_id_fkey"
            columns: ["reviewer_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_routine_template_fk"
            columns: ["routine_template_id"]
            isOneToOne: false
            referencedRelation: "routine_template_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_routine_template_fk"
            columns: ["routine_template_id"]
            isOneToOne: false
            referencedRelation: "routine_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["owner_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      team_directory: {
        Row: {
          employee_id: string | null
          full_name: string | null
          id: string | null
        }
        Insert: {
          employee_id?: string | null
          full_name?: string | null
          id?: string | null
        }
        Update: {
          employee_id?: string | null
          full_name?: string | null
          id?: string | null
        }
        Relationships: []
      }
      team_load_summary: {
        Row: {
          available_work_count: number | null
          decisions_pending: number | null
          department_id: string | null
          employee_id: string | null
          full_name: string | null
          open_barrier_count: number | null
          operational_created_this_week: number | null
          overdue_count: number | null
          quick_actions_created_this_week: number | null
          reporting_manager_id: string | null
          routines_completed_this_week: number | null
          routines_overdue: number | null
          routines_this_week: number | null
          stale_count: number | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "user_profiles_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_reporting_manager_id_fkey"
            columns: ["reporting_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_commitment_overview: {
        Row: {
          carried_from_id: string | null
          checklist_item_id: string | null
          decided_at: string | null
          decided_by: string | null
          decision_note: string | null
          delivery_outcome: string | null
          employee_id: string | null
          expected_result: string | null
          id: string | null
          is_step: boolean | null
          open_change_count: number | null
          primary_owner_id: string | null
          proposed_at: string | null
          proposed_by: string | null
          rank: number | null
          reference_title: string | null
          state: Database["public"]["Enums"]["weekly_commitment_state"] | null
          step_action: string | null
          step_state: Database["public"]["Enums"]["checklist_item_state"] | null
          superseded_by_id: string | null
          target_date: string | null
          task_due_at: string | null
          task_id: string | null
          task_status: Database["public"]["Enums"]["task_status"] | null
          task_title: string | null
          version: number | null
          week_start: string | null
          work_class: Database["public"]["Enums"]["work_class"] | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "tasks_primary_owner_id_fkey"
            columns: ["primary_owner_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_carried_from_id_fkey"
            columns: ["carried_from_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_carried_from_id_fkey"
            columns: ["carried_from_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "weekly_commitments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "weekly_commitments_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "weekly_commitments_proposed_by_fkey"
            columns: ["proposed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitment_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_superseded_by_id_fkey"
            columns: ["superseded_by_id"]
            isOneToOne: false
            referencedRelation: "weekly_commitments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "weekly_commitments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_workload_review: {
        Args: {
          p_active_count: number
          p_bucket: Database["public"]["Enums"]["focus_bucket"]
          p_idempotency_key?: string
          p_person_id: string
          p_recommended_target: number
        }
        Returns: Json
      }
      activate_task: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_reason_code?: Database["public"]["Enums"]["activation_reason"]
          p_reason_note?: string
          p_task_id: string
        }
        Returns: Json
      }
      add_barrier_to_meeting_queue: {
        Args: { p_barrier_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      agree_lean_goal_version: {
        Args: {
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_pending_version_id: string
        }
        Returns: Json
      }
      agree_weekly_commitment: {
        Args: { p_commitment_id: string; p_note?: string }
        Returns: Json
      }
      assign_work_to_people: {
        Args: {
          p_description: string
          p_due_at?: string
          p_due_is_date_only?: boolean
          p_idempotency_key?: string
          p_owner_ids: string[]
          p_review_at?: string
          p_title: string
          p_urgency?: Database["public"]["Enums"]["urgency_level"]
          p_work_class: Database["public"]["Enums"]["work_class"]
          p_work_purpose?: Database["public"]["Enums"]["work_purpose"]
        }
        Returns: Json
      }
      cancel_goal: {
        Args: {
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_reason: string
        }
        Returns: Json
      }
      cancel_task: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_reason: string
          p_task_id: string
        }
        Returns: Json
      }
      carry_forward_weekly_commitment: {
        Args: { p_commitment_id: string; p_week_start?: string }
        Returns: Json
      }
      change_task_due_date: {
        Args: {
          p_due_is_date_only: boolean
          p_expected_version: number
          p_idempotency_key?: string
          p_new_due_at: string
          p_reason?: string
          p_task_id: string
        }
        Returns: Json
      }
      claim_email_delivery: { Args: { p_delivery_id: string }; Returns: Json }
      claim_notification_email_delivery: {
        Args: { p_delivery_id: string }
        Returns: Json
      }
      clear_current_focus: { Args: never; Returns: Json }
      complete_checklist_item: {
        Args: {
          p_completion_note?: string
          p_idempotency_key?: string
          p_item_id: string
        }
        Returns: Json
      }
      complete_checklist_item_with_evidence: {
        Args: {
          p_attachments: Json
          p_completion_note?: string
          p_idempotency_key?: string
          p_item_id: string
        }
        Returns: Json
      }
      complete_goal: {
        Args: {
          p_expected_version: number
          p_final_result_summary: string
          p_goal_id: string
          p_idempotency_key?: string
          p_measure_results: Json
        }
        Returns: Json
      }
      complete_goal_quarterly_session: {
        Args: {
          p_employee_id: string
          p_idempotency_key?: string
          p_items: Json
          p_performance_period_id: string
          p_period_quarter: number
          p_period_year: number
          p_summary?: string
        }
        Returns: Json
      }
      complete_task: {
        Args: {
          p_completion_note?: string
          p_expected_version: number
          p_idempotency_key?: string
          p_task_id: string
        }
        Returns: Json
      }
      confirm_current_focus: { Args: never; Returns: Json }
      confirm_work_capture: {
        Args: {
          p_capture_id: string
          p_destination: Database["public"]["Enums"]["capture_destination"]
          p_idempotency_key?: string
          p_parent_task_id?: string
        }
        Returns: Json
      }
      convert_quick_action: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_reason?: string
          p_task_id: string
        }
        Returns: Json
      }
      create_lean_goal: {
        Args: {
          p_agreed_approach?: string
          p_baseline?: string
          p_category?: string
          p_dependencies?: string
          p_expected_result: string
          p_idempotency_key?: string
          p_measures: Json
          p_milestones?: Json
          p_owner_id: string
          p_purpose?: string
          p_submission_mode?: string
          p_support_needed?: string
          p_target_date: string
          p_weight_percent: number
        }
        Returns: Json
      }
      create_routine_template: {
        Args: {
          p_day_of_month: number
          p_description: string
          p_due_time: string
          p_ends_after_count?: number
          p_ends_mode?: string
          p_ends_on_date?: string
          p_evidence_instruction?: string
          p_evidence_required?: boolean
          p_frequency: Database["public"]["Enums"]["recurrence_frequency"]
          p_idempotency_key?: string
          p_interval_count: number
          p_month_of_year: number
          p_monthly_mode: string
          p_nth_weekday: number
          p_nth_weekday_dow: number
          p_owner_id: string
          p_requires_completion_review?: boolean
          p_start_date: string
          p_title: string
          p_weekdays: number[]
        }
        Returns: Json
      }
      current_week_start: { Args: never; Returns: string }
      deactivate_user: {
        Args: { p_allow_open_work?: boolean; p_user_id: string }
        Returns: Json
      }
      decide_completion_review: {
        Args: {
          p_decision: Database["public"]["Enums"]["review_decision"]
          p_idempotency_key?: string
          p_note?: string
          p_task_id: string
        }
        Returns: Json
      }
      decide_major_project_proposal: {
        Args: {
          p_decision: string
          p_expected_version: number
          p_idempotency_key?: string
          p_note?: string
          p_proposal_id: string
        }
        Returns: Json
      }
      decide_routine_exception: {
        Args: {
          p_accept: boolean
          p_exception_id: string
          p_idempotency_key?: string
          p_note?: string
        }
        Returns: Json
      }
      decline_weekly_commitment: {
        Args: { p_commitment_id: string; p_note: string }
        Returns: Json
      }
      delete_routine_template: {
        Args: { p_idempotency_key?: string; p_template_id: string }
        Returns: Json
      }
      delete_task: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_task_id: string
        }
        Returns: Json
      }
      delete_user_permanently: {
        Args: { p_employee_id_confirmation: string; p_user_id: string }
        Returns: Json
      }
      finalize_goal_plan: {
        Args: {
          p_employee_id: string
          p_expected_version: number
          p_idempotency_key?: string
          p_performance_period_id: string
        }
        Returns: Json
      }
      generate_routine_occurrences: {
        Args: { p_through?: string }
        Returns: Json
      }
      get_goal_capabilities: { Args: { p_goal_id: string }; Returns: Json }
      get_task_capabilities: { Args: { p_task_id: string }; Returns: Json }
      get_visibility_state: { Args: { p_viewer_id: string }; Returns: Json }
      get_work_proposal_capabilities: {
        Args: { p_proposal_id: string }
        Returns: Json
      }
      link_goal_work: {
        Args: {
          p_expected_version?: number
          p_goal_id: string
          p_idempotency_key?: string
          p_milestone_id?: string
          p_task_id: string
        }
        Returns: Json
      }
      mark_routine_not_required: {
        Args: {
          p_idempotency_key?: string
          p_reason_code: Database["public"]["Enums"]["routine_exception_reason"]
          p_reason_note?: string
          p_task_id: string
        }
        Returns: Json
      }
      move_task_to_available: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_task_id: string
        }
        Returns: Json
      }
      notify_overdue_contributions: {
        Args: { p_task_ids?: string[] }
        Returns: Json
      }
      pause_task: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_reason: string
          p_restart_at?: string
          p_task_id: string
        }
        Returns: Json
      }
      post_barrier_response:
        | {
            Args: {
              p_barrier_id: string
              p_expected_version?: number
              p_idempotency_key?: string
              p_kind?: Database["public"]["Enums"]["barrier_response_kind"]
              p_message: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_barrier_id: string
              p_idempotency_key?: string
              p_message: string
            }
            Returns: Json
          }
      post_goal_milestone_checkin: {
        Args: {
          p_attachments?: Json
          p_comment: string
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_mark_complete?: boolean
          p_milestone_id: string
          p_next_step?: string
          p_progress: number
          p_support_details?: string
          p_support_requested?: boolean
          p_what_changed: string
        }
        Returns: Json
      }
      post_goal_milestone_update: {
        Args: {
          p_attachments?: Json
          p_comment?: string
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_mark_complete?: boolean
          p_milestone_id: string
          p_progress: number
        }
        Returns: Json
      }
      post_task_update: {
        Args: {
          p_attachments?: Json
          p_body?: string
          p_checklist_item_id?: string
          p_idempotency_key?: string
          p_is_evidence_only?: boolean
          p_mention_ids?: string[]
          p_task_id: string
        }
        Returns: Json
      }
      preview_effective_visibility: {
        Args: { p_viewer_id: string }
        Returns: {
          employee_id: string
          full_name: string
          source: string
          user_id: string
        }[]
      }
      propose_weekly_commitment: {
        Args: {
          p_checklist_item_id?: string
          p_employee_id: string
          p_expected_result: string
          p_rank?: number
          p_target_date?: string
          p_task_id: string
          p_week_start?: string
        }
        Returns: Json
      }
      provision_user_profile: {
        Args: {
          p_actor_id?: string
          p_department_id: string
          p_email: string
          p_employee_id: string
          p_full_name: string
          p_personal_summary_mode?: Database["public"]["Enums"]["personal_summary_mode"]
          p_reporting_manager_id?: string
          p_role: Database["public"]["Enums"]["app_role"]
          p_team_summary_mode?: Database["public"]["Enums"]["team_summary_mode"]
          p_user_id: string
        }
        Returns: Json
      }
      purge_routine_template: {
        Args: { p_idempotency_key?: string; p_template_id: string }
        Returns: Json
      }
      purge_task: {
        Args: { p_idempotency_key?: string; p_task_id: string }
        Returns: Json
      }
      raise_barrier: {
        Args: {
          p_action_required_from?: string
          p_action_type?: Database["public"]["Enums"]["barrier_action_type"]
          p_add_to_meeting_queue?: boolean
          p_description: string
          p_idempotency_key?: string
          p_impact: Database["public"]["Enums"]["barrier_impact"]
          p_support_needed: string
          p_task_id: string
        }
        Returns: Json
      }
      raise_goal_support_request: {
        Args: {
          p_action_required_from?: string
          p_description: string
          p_goal_id: string
          p_idempotency_key?: string
          p_support_needed: string
        }
        Returns: Json
      }
      reactivate_user: { Args: { p_user_id: string }; Returns: Json }
      reassign_task: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_new_owner_id: string
          p_task_id: string
        }
        Returns: Json
      }
      record_attachment_view: {
        Args: { p_attachment_id: string }
        Returns: Json
      }
      record_goal_attachment_view: {
        Args: { p_attachment_id: string }
        Returns: Json
      }
      record_routine_finding: {
        Args: {
          p_description: string
          p_follow_up_owner_id?: string
          p_occurrence_task_id: string
          p_severity: Database["public"]["Enums"]["finding_severity"]
        }
        Returns: Json
      }
      remove_checklist_step: {
        Args: { p_idempotency_key?: string; p_item_id: string }
        Returns: Json
      }
      remove_meeting_queue_item: {
        Args: { p_idempotency_key?: string; p_item_id: string }
        Returns: Json
      }
      reopen_checklist_item: {
        Args: { p_item_id: string; p_reason?: string }
        Returns: Json
      }
      reorder_weekly_commitments: {
        Args: {
          p_employee_id: string
          p_ordered_ids: string[]
          p_week_start: string
        }
        Returns: Json
      }
      request_goal_update: {
        Args: {
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_message?: string
        }
        Returns: Json
      }
      request_weekly_commitment_change: {
        Args: {
          p_commitment_id: string
          p_kind: Database["public"]["Enums"]["weekly_change_kind"]
          p_payload?: Json
          p_reason: string
        }
        Returns: Json
      }
      resolve_barrier: {
        Args: { p_barrier_id: string; p_resolution_note: string }
        Returns: Json
      }
      resolve_goal_support: {
        Args: {
          p_idempotency_key?: string
          p_resolution_note: string
          p_support_request_id: string
        }
        Returns: Json
      }
      resolve_weekly_commitment_change: {
        Args: { p_accept: boolean; p_change_id: string; p_note?: string }
        Returns: Json
      }
      restore_routine_template: {
        Args: { p_idempotency_key?: string; p_template_id: string }
        Returns: Json
      }
      restore_task: {
        Args: { p_idempotency_key?: string; p_task_id: string }
        Returns: Json
      }
      resubmit_major_project_proposal: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_proposal_id: string
          p_rationale: string
          p_title: string
        }
        Returns: Json
      }
      resume_task: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_reason_code?: Database["public"]["Enums"]["activation_reason"]
          p_reason_note?: string
          p_task_id: string
        }
        Returns: Json
      }
      revise_lean_goal_version: {
        Args: {
          p_agreed_approach?: string
          p_baseline?: string
          p_dependencies?: string
          p_expected_result: string
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_measures: Json
          p_milestones?: Json
          p_purpose?: string
          p_revision_reason: string
          p_support_needed?: string
          p_target_date: string
          p_weight_percent: number
        }
        Returns: Json
      }
      save_goal_candidate_version: {
        Args: {
          p_agreed_approach?: string
          p_baseline?: string
          p_dependencies?: string
          p_expected_result: string
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_measures: Json
          p_milestones?: Json
          p_purpose?: string
          p_submission_mode?: string
          p_support_needed?: string
          p_target_date: string
          p_weight_percent: number
        }
        Returns: Json
      }
      save_lean_goal_version: {
        Args: {
          p_agreed_approach?: string
          p_baseline?: string
          p_dependencies?: string
          p_expected_result: string
          p_expected_version: number
          p_goal_id: string
          p_idempotency_key?: string
          p_measures: Json
          p_milestones?: Json
          p_purpose?: string
          p_submission_mode?: string
          p_support_needed?: string
          p_target_date: string
          p_weight_percent: number
        }
        Returns: Json
      }
      schedule_meeting_queue_item: {
        Args: {
          p_duration_minutes?: number
          p_idempotency_key?: string
          p_item_id: string
          p_participant_ids?: string[]
          p_starts_at: string
        }
        Returns: Json
      }
      set_current_focus: {
        Args: { p_checklist_item_id?: string; p_task_id: string }
        Returns: Json
      }
      set_routine_template_active: {
        Args: {
          p_active: boolean
          p_idempotency_key?: string
          p_template_id: string
        }
        Returns: Json
      }
      set_theme_colors: { Args: { p_colors: Json }; Returns: Json }
      set_user_visibility: {
        Args: {
          p_mode: Database["public"]["Enums"]["visibility_mode"]
          p_reason?: string
          p_subject_ids?: string[]
          p_viewer_id: string
        }
        Returns: Json
      }
      set_work_purpose: {
        Args: {
          p_expected_version?: number
          p_idempotency_key?: string
          p_purpose: Database["public"]["Enums"]["work_purpose"]
          p_task_id: string
        }
        Returns: Json
      }
      submit_goal_monthly_session: {
        Args: {
          p_employee_id: string
          p_idempotency_key?: string
          p_items: Json
          p_performance_period_id: string
          p_period_month: number
          p_period_year: number
        }
        Returns: Json
      }
      undo_event: {
        Args: { p_event_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      update_checklist_step: {
        Args: {
          p_action: string
          p_assigned_to: string
          p_depends_on_item_id: string
          p_due_at: string
          p_evidence_rule: Database["public"]["Enums"]["evidence_rule"]
          p_idempotency_key?: string
          p_item_id: string
        }
        Returns: Json
      }
      update_my_preferences: {
        Args: {
          p_assignment_changes: boolean
          p_barrier_involving_me: boolean
          p_collaboration_handoff: boolean
          p_daily_brief_hour: number
          p_daily_brief_mode: string
          p_default_landing_page: string
          p_due_today_and_deadlines: boolean
          p_first_day_of_week: number
          p_personal_summary_mode: Database["public"]["Enums"]["personal_summary_mode"]
          p_quiet_hours_enabled: boolean
          p_quiet_hours_end: number
          p_quiet_hours_start: number
          p_reduced_motion: boolean
          p_routine_upcoming: boolean
          p_shortcut_hints: boolean
          p_status_labels_always_visible: boolean
          p_text_size: string
          p_theme_preference: string
        }
        Returns: Json
      }
      update_routine_template: {
        Args: {
          p_day_of_month: number
          p_description: string
          p_due_time: string
          p_ends_after_count?: number
          p_ends_mode?: string
          p_ends_on_date?: string
          p_evidence_instruction?: string
          p_evidence_required?: boolean
          p_frequency: Database["public"]["Enums"]["recurrence_frequency"]
          p_idempotency_key?: string
          p_interval_count: number
          p_month_of_year: number
          p_monthly_mode: string
          p_nth_weekday: number
          p_nth_weekday_dow: number
          p_requires_completion_review?: boolean
          p_start_date: string
          p_template_id: string
          p_title: string
          p_weekdays: number[]
        }
        Returns: Json
      }
      update_task_details: {
        Args: {
          p_description?: string
          p_expected_version: number
          p_idempotency_key?: string
          p_task_id: string
          p_title: string
        }
        Returns: Json
      }
      update_user_profile: {
        Args: {
          p_department_id?: string
          p_email?: string
          p_full_name?: string
          p_personal_summary_mode?: Database["public"]["Enums"]["personal_summary_mode"]
          p_reporting_manager_id?: string
          p_role?: Database["public"]["Enums"]["app_role"]
          p_team_summary_mode?: Database["public"]["Enums"]["team_summary_mode"]
          p_user_id: string
        }
        Returns: Json
      }
      user_retained_history: { Args: { p_user_id: string }; Returns: Json }
      withdraw_routine_exception: {
        Args: { p_exception_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      withdraw_weekly_commitment: {
        Args: { p_commitment_id: string }
        Returns: Json
      }
    }
    Enums: {
      account_status: "active" | "deactivated"
      activation_reason:
        | "urgent_deadline"
        | "workload_peak"
        | "cannot_move_out"
        | "external_request"
        | "dependency"
        | "other"
      app_role: "team_member" | "manager" | "administrator"
      audit_event_type:
        | "task_created"
        | "task_classified"
        | "task_assigned"
        | "task_reassigned"
        | "task_activated"
        | "task_moved_to_available"
        | "task_paused"
        | "task_resumed"
        | "task_completed"
        | "task_cancelled"
        | "task_due_date_changed"
        | "task_urgency_changed"
        | "over_target_activation"
        | "checklist_item_completed"
        | "checklist_item_reopened"
        | "update_posted"
        | "attachment_added"
        | "attachment_opened"
        | "barrier_raised"
        | "barrier_resolved"
        | "relation_added"
        | "relation_removed"
        | "completion_submitted"
        | "completion_accepted"
        | "changes_requested"
        | "routine_occurrence_generated"
        | "routine_finding_recorded"
        | "meeting_decision_recorded"
        | "settings_changed"
        | "visibility_changed"
        | "focus_target_changed"
        | "user_created"
        | "user_updated"
        | "user_deactivated"
        | "user_reactivated"
        | "user_deleted"
        | "event_reversed"
        | "goal_created"
        | "goal_update_posted"
        | "goal_milestone_updated"
        | "goal_milestone_completed"
        | "goal_version_proposed"
        | "goal_version_agreed"
        | "goal_support_requested"
        | "goal_support_resolved"
        | "goal_work_linked"
        | "goal_update_requested"
        | "goal_completed"
        | "goal_closed"
        | "next_action_changed"
        | "next_action_completed"
        | "checklist_item_assigned"
        | "checklist_item_ready"
        | "barrier_response_posted"
        | "checklist_item_updated"
        | "checklist_item_removed"
        | "barrier_added_to_meeting_queue"
        | "meeting_queue_item_removed"
        | "discussion_scheduled"
        | "discussion_rescheduled"
        | "discussion_cancelled"
        | "goal_measure_updated"
        | "goal_monthly_checkin_submitted"
        | "goal_quarterly_checkin_submitted"
        | "goal_quarterly_checkin_agreed"
        | "goal_year_end_result_saved"
        | "goal_year_end_result_finalized"
        | "workload_review_accepted"
        | "work_proposal_agreed"
        | "work_proposal_changes_requested"
        | "work_proposal_declined"
        | "goal_monthly_session_submitted"
        | "goal_quarterly_session_completed"
        | "goal_cancelled"
        | "goal_plan_finalized"
        | "task_details_edited"
        | "task_deleted"
        | "task_restored"
        | "routine_template_created"
        | "routine_template_updated"
        | "routine_template_activated"
        | "routine_template_paused"
        | "routine_template_deleted"
        | "routine_template_restored"
        | "task_purged"
        | "routine_template_purged"
        | "routine_not_required_raised"
        | "routine_not_required_accepted"
        | "routine_not_required_returned"
        | "work_purpose_set"
        | "routine_not_required_withdrawn"
      barrier_action_type:
        | "decision"
        | "approval"
        | "support"
        | "escalation"
        | "other"
      barrier_impact:
        | "may_delay"
        | "cannot_continue"
        | "safety_or_compliance_risk"
        | "management_decision_required"
      barrier_response_kind: "answer" | "approved" | "changes_requested"
      barrier_status: "open" | "resolved"
      capture_destination:
        | "quick_action"
        | "operational_available_work"
        | "routine_template_request"
        | "self_development_plan"
        | "collaborative_contribution"
        | "major_project_request"
        | "mandatory_operational_action"
      capture_status: "pending_confirmation" | "confirmed" | "discarded"
      checklist_item_state: "waiting" | "ready" | "completed"
      email_delivery_status:
        | "queued"
        | "processing"
        | "sent"
        | "failed"
        | "undeliverable"
      email_summary_type: "personal" | "manager_team"
      evidence_rule: "not_required" | "optional" | "required"
      finding_severity: "minor" | "significant" | "immediate_risk"
      focus_bucket: "major" | "operational" | "self_development"
      focus_target_scope: "system" | "department" | "user"
      goal_checkin_status: "draft" | "submitted" | "agreed" | "finalized"
      goal_checkin_type: "monthly" | "quarterly" | "year_end"
      goal_governance_mode: "department_only" | "organization_hierarchy"
      goal_health:
        | "on_track"
        | "need_attention"
        | "support_requested"
        | "completed"
        | "at_risk"
        | "off_track"
      goal_measure_state:
        | "not_started"
        | "progressing"
        | "achieved"
        | "exceeded"
      goal_measure_type: "number" | "percentage" | "qualitative"
      goal_plan_status: "draft" | "finalized" | "reallocation_required"
      goal_session_kind: "monthly" | "quarterly"
      goal_session_status: "draft" | "submitted" | "completed"
      goal_status:
        | "draft"
        | "pending_discussion"
        | "active"
        | "completed"
        | "closed"
        | "cancelled"
      goal_update_kind: "overall" | "milestone" | "comment"
      goal_version_status: "pending" | "active" | "superseded" | "rejected"
      meeting_item_source:
        | "barrier"
        | "overdue_high_impact"
        | "stale_work"
        | "over_target_focus"
        | "missed_selection_deadline"
        | "completion_review_overdue"
        | "unresolved_dependency"
      meeting_item_status:
        | "open"
        | "decided"
        | "dismissed"
        | "queued"
        | "scheduled"
        | "removed"
      notification_channel: "immediate" | "digest"
      notification_kind:
        | "barrier_raised"
        | "work_cannot_continue"
        | "mandatory_action"
        | "manager_decision_required"
        | "reassignment"
        | "completion_review_assigned"
        | "over_target_activation"
        | "ordinary_assignment"
        | "routine_upcoming"
        | "due_soon"
        | "stale_work"
        | "collaboration_handoff"
        | "ownership_changed"
        | "goal_support_requested"
        | "goal_update_requested"
        | "goal_version_ready"
        | "goal_milestone_completed"
        | "goal_manager_attention"
        | "goal_quarterly_due"
        | "goal_year_end_due"
      personal_summary_mode: "off" | "focused" | "standard"
      proposal_status:
        | "pending"
        | "approved"
        | "rejected"
        | "changes_requested"
        | "declined"
      recurrence_frequency: "daily" | "weekly" | "monthly" | "yearly"
      relation_type: "before" | "after" | "related"
      review_decision: "accepted" | "changes_requested"
      review_status: "pending" | "decided" | "not_required"
      routine_exception_reason:
        | "no_applicable_work"
        | "activity_cancelled"
        | "other"
      routine_exception_state: "pending" | "accepted" | "returned" | "withdrawn"
      task_status: "backlog" | "active" | "paused" | "completed" | "cancelled"
      team_summary_mode: "off" | "leadership" | "detailed"
      urgency_level: "normal" | "high" | "critical"
      visibility_mode: "specific_only" | "direct_reports_plus" | "none"
      weekly_change_kind: "amend" | "remove" | "cannot_meet"
      weekly_change_state: "pending" | "accepted" | "rejected" | "withdrawn"
      weekly_commitment_state:
        | "proposed"
        | "agreed"
        | "declined"
        | "withdrawn"
        | "superseded"
      work_class:
        | "quick_action"
        | "major_project"
        | "operational_action"
        | "self_development"
        | "routine_occurrence"
        | "collaborative_contribution"
      work_origin:
        | "manager_assigned"
        | "self_initiated"
        | "routine_generated"
        | "finding_generated"
        | "collaborative"
        | "meeting_generated"
        | "system_generated"
      work_purpose:
        | "reactive"
        | "planned_operations"
        | "improvement_development"
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
      account_status: ["active", "deactivated"],
      activation_reason: [
        "urgent_deadline",
        "workload_peak",
        "cannot_move_out",
        "external_request",
        "dependency",
        "other",
      ],
      app_role: ["team_member", "manager", "administrator"],
      audit_event_type: [
        "task_created",
        "task_classified",
        "task_assigned",
        "task_reassigned",
        "task_activated",
        "task_moved_to_available",
        "task_paused",
        "task_resumed",
        "task_completed",
        "task_cancelled",
        "task_due_date_changed",
        "task_urgency_changed",
        "over_target_activation",
        "checklist_item_completed",
        "checklist_item_reopened",
        "update_posted",
        "attachment_added",
        "attachment_opened",
        "barrier_raised",
        "barrier_resolved",
        "relation_added",
        "relation_removed",
        "completion_submitted",
        "completion_accepted",
        "changes_requested",
        "routine_occurrence_generated",
        "routine_finding_recorded",
        "meeting_decision_recorded",
        "settings_changed",
        "visibility_changed",
        "focus_target_changed",
        "user_created",
        "user_updated",
        "user_deactivated",
        "user_reactivated",
        "user_deleted",
        "event_reversed",
        "goal_created",
        "goal_update_posted",
        "goal_milestone_updated",
        "goal_milestone_completed",
        "goal_version_proposed",
        "goal_version_agreed",
        "goal_support_requested",
        "goal_support_resolved",
        "goal_work_linked",
        "goal_update_requested",
        "goal_completed",
        "goal_closed",
        "next_action_changed",
        "next_action_completed",
        "checklist_item_assigned",
        "checklist_item_ready",
        "barrier_response_posted",
        "checklist_item_updated",
        "checklist_item_removed",
        "barrier_added_to_meeting_queue",
        "meeting_queue_item_removed",
        "discussion_scheduled",
        "discussion_rescheduled",
        "discussion_cancelled",
        "goal_measure_updated",
        "goal_monthly_checkin_submitted",
        "goal_quarterly_checkin_submitted",
        "goal_quarterly_checkin_agreed",
        "goal_year_end_result_saved",
        "goal_year_end_result_finalized",
        "workload_review_accepted",
        "work_proposal_agreed",
        "work_proposal_changes_requested",
        "work_proposal_declined",
        "goal_monthly_session_submitted",
        "goal_quarterly_session_completed",
        "goal_cancelled",
        "goal_plan_finalized",
        "task_details_edited",
        "task_deleted",
        "task_restored",
        "routine_template_created",
        "routine_template_updated",
        "routine_template_activated",
        "routine_template_paused",
        "routine_template_deleted",
        "routine_template_restored",
        "task_purged",
        "routine_template_purged",
        "routine_not_required_raised",
        "routine_not_required_accepted",
        "routine_not_required_returned",
        "work_purpose_set",
        "routine_not_required_withdrawn",
      ],
      barrier_action_type: [
        "decision",
        "approval",
        "support",
        "escalation",
        "other",
      ],
      barrier_impact: [
        "may_delay",
        "cannot_continue",
        "safety_or_compliance_risk",
        "management_decision_required",
      ],
      barrier_response_kind: ["answer", "approved", "changes_requested"],
      barrier_status: ["open", "resolved"],
      capture_destination: [
        "quick_action",
        "operational_available_work",
        "routine_template_request",
        "self_development_plan",
        "collaborative_contribution",
        "major_project_request",
        "mandatory_operational_action",
      ],
      capture_status: ["pending_confirmation", "confirmed", "discarded"],
      checklist_item_state: ["waiting", "ready", "completed"],
      email_delivery_status: [
        "queued",
        "processing",
        "sent",
        "failed",
        "undeliverable",
      ],
      email_summary_type: ["personal", "manager_team"],
      evidence_rule: ["not_required", "optional", "required"],
      finding_severity: ["minor", "significant", "immediate_risk"],
      focus_bucket: ["major", "operational", "self_development"],
      focus_target_scope: ["system", "department", "user"],
      goal_checkin_status: ["draft", "submitted", "agreed", "finalized"],
      goal_checkin_type: ["monthly", "quarterly", "year_end"],
      goal_governance_mode: ["department_only", "organization_hierarchy"],
      goal_health: [
        "on_track",
        "need_attention",
        "support_requested",
        "completed",
        "at_risk",
        "off_track",
      ],
      goal_measure_state: [
        "not_started",
        "progressing",
        "achieved",
        "exceeded",
      ],
      goal_measure_type: ["number", "percentage", "qualitative"],
      goal_plan_status: ["draft", "finalized", "reallocation_required"],
      goal_session_kind: ["monthly", "quarterly"],
      goal_session_status: ["draft", "submitted", "completed"],
      goal_status: [
        "draft",
        "pending_discussion",
        "active",
        "completed",
        "closed",
        "cancelled",
      ],
      goal_update_kind: ["overall", "milestone", "comment"],
      goal_version_status: ["pending", "active", "superseded", "rejected"],
      meeting_item_source: [
        "barrier",
        "overdue_high_impact",
        "stale_work",
        "over_target_focus",
        "missed_selection_deadline",
        "completion_review_overdue",
        "unresolved_dependency",
      ],
      meeting_item_status: [
        "open",
        "decided",
        "dismissed",
        "queued",
        "scheduled",
        "removed",
      ],
      notification_channel: ["immediate", "digest"],
      notification_kind: [
        "barrier_raised",
        "work_cannot_continue",
        "mandatory_action",
        "manager_decision_required",
        "reassignment",
        "completion_review_assigned",
        "over_target_activation",
        "ordinary_assignment",
        "routine_upcoming",
        "due_soon",
        "stale_work",
        "collaboration_handoff",
        "ownership_changed",
        "goal_support_requested",
        "goal_update_requested",
        "goal_version_ready",
        "goal_milestone_completed",
        "goal_manager_attention",
        "goal_quarterly_due",
        "goal_year_end_due",
      ],
      personal_summary_mode: ["off", "focused", "standard"],
      proposal_status: [
        "pending",
        "approved",
        "rejected",
        "changes_requested",
        "declined",
      ],
      recurrence_frequency: ["daily", "weekly", "monthly", "yearly"],
      relation_type: ["before", "after", "related"],
      review_decision: ["accepted", "changes_requested"],
      review_status: ["pending", "decided", "not_required"],
      routine_exception_reason: [
        "no_applicable_work",
        "activity_cancelled",
        "other",
      ],
      routine_exception_state: ["pending", "accepted", "returned", "withdrawn"],
      task_status: ["backlog", "active", "paused", "completed", "cancelled"],
      team_summary_mode: ["off", "leadership", "detailed"],
      urgency_level: ["normal", "high", "critical"],
      visibility_mode: ["specific_only", "direct_reports_plus", "none"],
      weekly_change_kind: ["amend", "remove", "cannot_meet"],
      weekly_change_state: ["pending", "accepted", "rejected", "withdrawn"],
      weekly_commitment_state: [
        "proposed",
        "agreed",
        "declined",
        "withdrawn",
        "superseded",
      ],
      work_class: [
        "quick_action",
        "major_project",
        "operational_action",
        "self_development",
        "routine_occurrence",
        "collaborative_contribution",
      ],
      work_origin: [
        "manager_assigned",
        "self_initiated",
        "routine_generated",
        "finding_generated",
        "collaborative",
        "meeting_generated",
        "system_generated",
      ],
      work_purpose: [
        "reactive",
        "planned_operations",
        "improvement_development",
      ],
    },
  },
} as const

