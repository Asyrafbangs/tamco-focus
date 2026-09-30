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
          head_id: string | null
          id: string
          name: string
          parent_id: string | null
          status: Database["public"]["Enums"]["department_status"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          head_id?: string | null
          id?: string
          name: string
          parent_id?: string | null
          status?: Database["public"]["Enums"]["department_status"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          head_id?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          status?: Database["public"]["Enums"]["department_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "departments_head_id_fkey"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "departments_head_id_fkey"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_head_id_fkey"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_head_id_fkey"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "departments_head_id_fkey"
            columns: ["head_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "departments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
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
      esh_access_grants: {
        Row: {
          action_id: string | null
          assignment_version: number | null
          consumed_at: string | null
          consumed_session_id: string | null
          expires_at: string
          id: string
          issued_at: string
          issued_reason: string
          organization_id: string
          outbox_id: string | null
          principal_id: string
          purpose: string
          receipt_expires_at: string | null
          receipt_hash: string | null
          report_recipient_id: string | null
          report_run_id: string | null
          revoked_at: string | null
          revoked_reason: string | null
          token_hash: string
        }
        Insert: {
          action_id?: string | null
          assignment_version?: number | null
          consumed_at?: string | null
          consumed_session_id?: string | null
          expires_at: string
          id?: string
          issued_at?: string
          issued_reason: string
          organization_id: string
          outbox_id?: string | null
          principal_id: string
          purpose: string
          receipt_expires_at?: string | null
          receipt_hash?: string | null
          report_recipient_id?: string | null
          report_run_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash: string
        }
        Update: {
          action_id?: string | null
          assignment_version?: number | null
          consumed_at?: string | null
          consumed_session_id?: string | null
          expires_at?: string
          id?: string
          issued_at?: string
          issued_reason?: string
          organization_id?: string
          outbox_id?: string | null
          principal_id?: string
          purpose?: string
          receipt_expires_at?: string | null
          receipt_hash?: string | null
          report_recipient_id?: string | null
          report_run_id?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_access_grants_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_access_grants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_access_grants_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_access_grants_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "esh_notification_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_access_grants_report_recipient_id_fkey"
            columns: ["report_recipient_id"]
            isOneToOne: false
            referencedRelation: "esh_report_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_access_grants_report_run_id_fkey"
            columns: ["report_run_id"]
            isOneToOne: false
            referencedRelation: "esh_report_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_grants_consumed_session_fk"
            columns: ["consumed_session_id"]
            isOneToOne: false
            referencedRelation: "esh_guest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_action_assignments: {
        Row: {
          action_id: string
          assigned_by: string
          ended_at: string | null
          followup_level_days: number[]
          followup_overdue_every_days: number
          followup_pre_due_days: number
          followup_remind_on_due: boolean
          followup_review_reminder_days: number
          id: string
          organization_id: string
          policy_version: number
          principal_id: string
          reason: string | null
          started_at: string
          version: number
        }
        Insert: {
          action_id: string
          assigned_by: string
          ended_at?: string | null
          followup_level_days: number[]
          followup_overdue_every_days: number
          followup_pre_due_days: number
          followup_remind_on_due: boolean
          followup_review_reminder_days: number
          id?: string
          organization_id: string
          policy_version: number
          principal_id: string
          reason?: string | null
          started_at?: string
          version: number
        }
        Update: {
          action_id?: string
          assigned_by?: string
          ended_at?: string | null
          followup_level_days?: number[]
          followup_overdue_every_days?: number
          followup_pre_due_days?: number
          followup_remind_on_due?: boolean
          followup_review_reminder_days?: number
          id?: string
          organization_id?: string
          policy_version?: number
          principal_id?: string
          reason?: string | null
          started_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "esh_action_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_assignments_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_action_assignments_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_action_escalation_recipients: {
        Row: {
          action_id: string
          added_at: string
          added_by: string
          id: string
          level: number
          organization_id: string
          principal_id: string
          removed_at: string | null
          removed_by: string | null
        }
        Insert: {
          action_id: string
          added_at?: string
          added_by: string
          id?: string
          level: number
          organization_id: string
          principal_id: string
          removed_at?: string | null
          removed_by?: string | null
        }
        Update: {
          action_id?: string
          added_at?: string
          added_by?: string
          id?: string
          level?: number
          organization_id?: string
          principal_id?: string
          removed_at?: string | null
          removed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_action_escalation_recipie_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_added_by_fkey"
            columns: ["added_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_escalation_recipients_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_action_messages: {
        Row: {
          action_id: string
          author_email: string
          author_kind: string
          author_name: string | null
          author_principal_id: string | null
          author_user_id: string | null
          body: string
          bulk_operation_id: string | null
          client_key: string
          id: string
          kind: string
          organization_id: string
          proposed_due_date: string | null
          proposed_owner_email: string | null
          sent_at: string
        }
        Insert: {
          action_id: string
          author_email: string
          author_kind: string
          author_name?: string | null
          author_principal_id?: string | null
          author_user_id?: string | null
          body: string
          bulk_operation_id?: string | null
          client_key: string
          id?: string
          kind?: string
          organization_id: string
          proposed_due_date?: string | null
          proposed_owner_email?: string | null
          sent_at?: string
        }
        Update: {
          action_id?: string
          author_email?: string
          author_kind?: string
          author_name?: string | null
          author_principal_id?: string | null
          author_user_id?: string | null
          body?: string
          bulk_operation_id?: string | null
          client_key?: string
          id?: string
          kind?: string
          organization_id?: string
          proposed_due_date?: string | null
          proposed_owner_email?: string | null
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_action_messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_action_messages_author_user_id_fkey"
            columns: ["author_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_messages_bulk_operation_id_fkey"
            columns: ["bulk_operation_id"]
            isOneToOne: false
            referencedRelation: "esh_bulk_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_messages_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_action_messages_organization_id_author_principal_id_fkey"
            columns: ["organization_id", "author_principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_action_submissions: {
        Row: {
          action_id: string
          assignment_version: number
          baseline_due_at_snapshot: string | null
          client_key: string
          closed_at: string | null
          closed_reason: string | null
          due_at_snapshot: string | null
          evidence_asset_ids: string[]
          id: string
          message_id: string
          organization_id: string
          owner_email: string
          principal_id: string
          result_text: string
          state: string
          submitted_at: string
          version: number
        }
        Insert: {
          action_id: string
          assignment_version: number
          baseline_due_at_snapshot?: string | null
          client_key: string
          closed_at?: string | null
          closed_reason?: string | null
          due_at_snapshot?: string | null
          evidence_asset_ids?: string[]
          id?: string
          message_id: string
          organization_id: string
          owner_email: string
          principal_id: string
          result_text: string
          state?: string
          submitted_at?: string
          version: number
        }
        Update: {
          action_id?: string
          assignment_version?: number
          baseline_due_at_snapshot?: string | null
          client_key?: string
          closed_at?: string | null
          closed_reason?: string | null
          due_at_snapshot?: string | null
          evidence_asset_ids?: string[]
          id?: string
          message_id?: string
          organization_id?: string
          owner_email?: string
          principal_id?: string
          result_text?: string
          state?: string
          submitted_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "esh_action_submissions_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "esh_action_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_action_submissions_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_action_submissions_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_audit_events: {
        Row: {
          action_id: string | null
          actor_kind: string
          actor_principal_id: string | null
          actor_user_id: string | null
          detail: Json
          event_type: string
          finding_id: string | null
          id: string
          occurred_at: string
          organization_id: string
          subject_principal_id: string | null
          subject_user_id: string | null
        }
        Insert: {
          action_id?: string | null
          actor_kind: string
          actor_principal_id?: string | null
          actor_user_id?: string | null
          detail?: Json
          event_type: string
          finding_id?: string | null
          id?: string
          occurred_at?: string
          organization_id: string
          subject_principal_id?: string | null
          subject_user_id?: string | null
        }
        Update: {
          action_id?: string | null
          actor_kind?: string
          actor_principal_id?: string | null
          actor_user_id?: string | null
          detail?: Json
          event_type?: string
          finding_id?: string | null
          id?: string
          occurred_at?: string
          organization_id?: string
          subject_principal_id?: string | null
          subject_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_audit_events_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_audit_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_audit_events_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_bulk_operation_items: {
        Row: {
          action_id: string
          asset_id: string | null
          code: string | null
          created_at: string
          message_id: string | null
          operation_id: string
          state: string
          submission_id: string | null
        }
        Insert: {
          action_id: string
          asset_id?: string | null
          code?: string | null
          created_at?: string
          message_id?: string | null
          operation_id: string
          state: string
          submission_id?: string | null
        }
        Update: {
          action_id?: string
          asset_id?: string | null
          code?: string | null
          created_at?: string
          message_id?: string | null
          operation_id?: string
          state?: string
          submission_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_bulk_operation_items_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "esh_evidence_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_bulk_operation_items_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "esh_action_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_bulk_operation_items_operation_id_fkey"
            columns: ["operation_id"]
            isOneToOne: false
            referencedRelation: "esh_bulk_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_bulk_operation_items_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "esh_action_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_bulk_operations: {
        Row: {
          created_at: string
          failed: number
          id: string
          operation_key: string
          organization_id: string
          principal_id: string
          purpose: string
          requested: number
          session_id: string | null
          skipped: number
          succeeded: number
        }
        Insert: {
          created_at?: string
          failed?: number
          id?: string
          operation_key: string
          organization_id: string
          principal_id: string
          purpose: string
          requested?: number
          session_id?: string | null
          skipped?: number
          succeeded?: number
        }
        Update: {
          created_at?: string
          failed?: number
          id?: string
          operation_key?: string
          organization_id?: string
          principal_id?: string
          purpose?: string
          requested?: number
          session_id?: string | null
          skipped?: number
          succeeded?: number
        }
        Relationships: [
          {
            foreignKeyName: "esh_bulk_operations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_bulk_operations_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_bulk_operations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "esh_guest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_delivery_events: {
        Row: {
          detail: string | null
          event_type: string
          id: string
          occurred_at: string
          organization_id: string
          outbox_id: string
          provider_event_id: string
          provider_message_id: string | null
          received_at: string
        }
        Insert: {
          detail?: string | null
          event_type: string
          id?: string
          occurred_at: string
          organization_id: string
          outbox_id: string
          provider_event_id: string
          provider_message_id?: string | null
          received_at?: string
        }
        Update: {
          detail?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          organization_id?: string
          outbox_id?: string
          provider_event_id?: string
          provider_message_id?: string | null
          received_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_delivery_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_delivery_events_outbox_id_fkey"
            columns: ["outbox_id"]
            isOneToOne: false
            referencedRelation: "esh_notification_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_department_escalation_defaults: {
        Row: {
          canonical_email: string
          department_id: string
          email: string
          id: string
          level: number
          organization_id: string
          updated_at: string
          updated_by: string
        }
        Insert: {
          canonical_email: string
          department_id: string
          email: string
          id?: string
          level: number
          organization_id: string
          updated_at?: string
          updated_by: string
        }
        Update: {
          canonical_email?: string
          department_id?: string
          email?: string
          id?: string
          level?: number
          organization_id?: string
          updated_at?: string
          updated_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_department_escalation_defaults_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_department_escalation_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_department_escalation_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_department_escalation_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_department_escalation_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_department_escalation_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_department_escalation_defaults_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_digest_members: {
        Row: {
          action_id: string
          created_at: string
          digest_id: string
          escalation_level: number | null
          member_id: string | null
          removed_reason: string | null
          state: string
        }
        Insert: {
          action_id: string
          created_at?: string
          digest_id: string
          escalation_level?: number | null
          member_id?: string | null
          removed_reason?: string | null
          state?: string
        }
        Update: {
          action_id?: string
          created_at?: string
          digest_id?: string
          escalation_level?: number | null
          member_id?: string | null
          removed_reason?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_digest_members_digest_id_fkey"
            columns: ["digest_id"]
            isOneToOne: false
            referencedRelation: "esh_notification_outbox"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_digest_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "esh_notification_outbox"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_due_date_changes: {
        Row: {
          action_id: string
          baseline_due_at: string | null
          cause: string
          changed_at: string
          changed_by: string
          id: string
          new_date_only: boolean
          new_due_at: string
          old_date_only: boolean | null
          old_due_at: string | null
          organization_id: string
          reason: string
        }
        Insert: {
          action_id: string
          baseline_due_at?: string | null
          cause: string
          changed_at?: string
          changed_by: string
          id?: string
          new_date_only: boolean
          new_due_at: string
          old_date_only?: boolean | null
          old_due_at?: string | null
          organization_id: string
          reason: string
        }
        Update: {
          action_id?: string
          baseline_due_at?: string | null
          cause?: string
          changed_at?: string
          changed_by?: string
          id?: string
          new_date_only?: boolean
          new_due_at?: string
          old_date_only?: boolean | null
          old_due_at?: string | null
          organization_id?: string
          reason?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_due_date_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_due_date_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_due_date_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_due_date_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_due_date_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_due_date_changes_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_email_principals: {
        Row: {
          access_disabled_at: string | null
          access_disabled_by: string | null
          access_enabled: boolean
          access_enabled_at: string | null
          access_enabled_by: string | null
          access_reason: string | null
          authorization_version: number
          canonical_email: string
          created_at: string
          created_by: string | null
          display_email: string
          display_name: string | null
          id: string
          identity_version: number
          organization_id: string
          staff_user_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          access_disabled_at?: string | null
          access_disabled_by?: string | null
          access_enabled?: boolean
          access_enabled_at?: string | null
          access_enabled_by?: string | null
          access_reason?: string | null
          authorization_version?: number
          canonical_email: string
          created_at?: string
          created_by?: string | null
          display_email: string
          display_name?: string | null
          id?: string
          identity_version?: number
          organization_id: string
          staff_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          access_disabled_at?: string | null
          access_disabled_by?: string | null
          access_enabled?: boolean
          access_enabled_at?: string | null
          access_enabled_by?: string | null
          access_reason?: string | null
          authorization_version?: number
          canonical_email?: string
          created_at?: string
          created_by?: string | null
          display_email?: string
          display_name?: string | null
          id?: string
          identity_version?: number
          organization_id?: string
          staff_user_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_email_principals_access_disabled_by_fkey"
            columns: ["access_disabled_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_disabled_by_fkey"
            columns: ["access_disabled_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_disabled_by_fkey"
            columns: ["access_disabled_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_disabled_by_fkey"
            columns: ["access_disabled_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_disabled_by_fkey"
            columns: ["access_disabled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_enabled_by_fkey"
            columns: ["access_enabled_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_enabled_by_fkey"
            columns: ["access_enabled_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_enabled_by_fkey"
            columns: ["access_enabled_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_enabled_by_fkey"
            columns: ["access_enabled_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_access_enabled_by_fkey"
            columns: ["access_enabled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_email_principals_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_email_principals_staff_user_id_fkey"
            columns: ["staff_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_escalation_entitlements: {
        Row: {
          acknowledged_at: string | null
          action_id: string
          activated_at: string
          activated_event_id: string | null
          assignment_version: number
          id: string
          level: number
          organization_id: string
          principal_id: string
          revoked_at: string | null
          revoked_reason: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          action_id: string
          activated_at?: string
          activated_event_id?: string | null
          assignment_version: number
          id?: string
          level: number
          organization_id: string
          principal_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          action_id?: string
          activated_at?: string
          activated_event_id?: string | null
          assignment_version?: number
          id?: string
          level?: number
          organization_id?: string
          principal_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_escalation_entitlements_activated_event_id_fkey"
            columns: ["activated_event_id"]
            isOneToOne: false
            referencedRelation: "esh_followup_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_escalation_entitlements_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_escalation_entitlements_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_evidence_assets: {
        Row: {
          action_id: string | null
          content_sha256: string | null
          content_type: string | null
          created_at: string
          declared_size: number
          finding_id: string
          id: string
          message_id: string | null
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at: string | null
          rejected_reason: string | null
          removed_at: string | null
          removed_by: string | null
          scan_state: string
          shared_from_asset_id: string | null
          shared_operation_id: string | null
          size_bytes: number | null
          state: string
          uploader_kind: string
          uploader_principal_id: string | null
          uploader_user_id: string | null
        }
        Insert: {
          action_id?: string | null
          content_sha256?: string | null
          content_type?: string | null
          created_at?: string
          declared_size: number
          finding_id: string
          id?: string
          message_id?: string | null
          object_key: string
          organization_id: string
          original_name: string
          purpose: string
          ready_at?: string | null
          rejected_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          scan_state?: string
          shared_from_asset_id?: string | null
          shared_operation_id?: string | null
          size_bytes?: number | null
          state?: string
          uploader_kind: string
          uploader_principal_id?: string | null
          uploader_user_id?: string | null
        }
        Update: {
          action_id?: string | null
          content_sha256?: string | null
          content_type?: string | null
          created_at?: string
          declared_size?: number
          finding_id?: string
          id?: string
          message_id?: string | null
          object_key?: string
          organization_id?: string
          original_name?: string
          purpose?: string
          ready_at?: string | null
          rejected_reason?: string | null
          removed_at?: string | null
          removed_by?: string | null
          scan_state?: string
          shared_from_asset_id?: string | null
          shared_operation_id?: string | null
          size_bytes?: number | null
          state?: string
          uploader_kind?: string
          uploader_principal_id?: string | null
          uploader_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_evidence_assets_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "esh_action_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_organization_id_uploader_principal_id_fkey"
            columns: ["organization_id", "uploader_principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_removed_by_fkey"
            columns: ["removed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_shared_from_asset_id_fkey"
            columns: ["shared_from_asset_id"]
            isOneToOne: false
            referencedRelation: "esh_evidence_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_shared_operation_id_fkey"
            columns: ["shared_operation_id"]
            isOneToOne: false
            referencedRelation: "esh_bulk_operations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_evidence_assets_uploader_user_id_fkey"
            columns: ["uploader_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_finding_actions: {
        Row: {
          accepted_at: string | null
          assigned_at: string | null
          assignment_version: number
          baseline_due_at: string | null
          created_at: string
          created_by: string
          current_submission_id: string | null
          draft_escalation: Json
          draft_owner_email: string | null
          due_at: string | null
          due_is_date_only: boolean
          evidence_exception_reason: string | null
          evidence_instruction: string | null
          evidence_rule: string
          finding_id: string
          followup_active_from: string | null
          id: string
          no_further_escalation_reason: string | null
          organization_id: string
          owner_principal_id: string | null
          priority: string | null
          required_outcome: string | null
          reviewer_user_id: string | null
          row_version: number
          sequence: number
          state: string
          title: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          assigned_at?: string | null
          assignment_version?: number
          baseline_due_at?: string | null
          created_at?: string
          created_by: string
          current_submission_id?: string | null
          draft_escalation?: Json
          draft_owner_email?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          evidence_exception_reason?: string | null
          evidence_instruction?: string | null
          evidence_rule?: string
          finding_id: string
          followup_active_from?: string | null
          id?: string
          no_further_escalation_reason?: string | null
          organization_id: string
          owner_principal_id?: string | null
          priority?: string | null
          required_outcome?: string | null
          reviewer_user_id?: string | null
          row_version?: number
          sequence?: number
          state?: string
          title: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          assigned_at?: string | null
          assignment_version?: number
          baseline_due_at?: string | null
          created_at?: string
          created_by?: string
          current_submission_id?: string | null
          draft_escalation?: Json
          draft_owner_email?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          evidence_exception_reason?: string | null
          evidence_instruction?: string | null
          evidence_rule?: string
          finding_id?: string
          followup_active_from?: string | null
          id?: string
          no_further_escalation_reason?: string | null
          organization_id?: string
          owner_principal_id?: string | null
          priority?: string | null
          required_outcome?: string | null
          reviewer_user_id?: string | null
          row_version?: number
          sequence?: number
          state?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_finding_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_finding_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_finding_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_finding_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_finding_actions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_finding_actions_current_submission_id_fkey"
            columns: ["current_submission_id"]
            isOneToOne: false
            referencedRelation: "esh_action_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_finding_actions_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_finding_actions_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_finding_actions_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_finding_actions_organization_id_owner_principal_id_fkey"
            columns: ["organization_id", "owner_principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_finding_actions_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_finding_actions_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_finding_actions_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_finding_actions_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_finding_actions_reviewer_user_id_fkey"
            columns: ["reviewer_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_findings: {
        Row: {
          accountable_department_id: string | null
          closed_at: string | null
          closed_by: string | null
          closure_note: string | null
          created_at: string
          created_by: string
          description: string | null
          duplicate_of_finding_id: string | null
          id: string
          import_batch_id: string | null
          import_row_id: string | null
          is_restricted: boolean
          location: string | null
          organization_id: string
          reference: string
          reopen_reason: string | null
          reopened_at: string | null
          reopened_by: string | null
          reported_on: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolved_outcome: string | null
          risk_assessed_at: string | null
          risk_assessed_by: string | null
          risk_level: string
          row_version: number
          source: string
          source_reference: string | null
          source_register: string | null
          status: string
          status_reason: string | null
          title: string
          updated_at: string
        }
        Insert: {
          accountable_department_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_note?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          duplicate_of_finding_id?: string | null
          id?: string
          import_batch_id?: string | null
          import_row_id?: string | null
          is_restricted?: boolean
          location?: string | null
          organization_id: string
          reference: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          reported_on?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_outcome?: string | null
          risk_assessed_at?: string | null
          risk_assessed_by?: string | null
          risk_level?: string
          row_version?: number
          source?: string
          source_reference?: string | null
          source_register?: string | null
          status?: string
          status_reason?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          accountable_department_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          closure_note?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          duplicate_of_finding_id?: string | null
          id?: string
          import_batch_id?: string | null
          import_row_id?: string | null
          is_restricted?: boolean
          location?: string | null
          organization_id?: string
          reference?: string
          reopen_reason?: string | null
          reopened_at?: string | null
          reopened_by?: string | null
          reported_on?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolved_outcome?: string | null
          risk_assessed_at?: string | null
          risk_assessed_by?: string | null
          risk_level?: string
          row_version?: number
          source?: string
          source_reference?: string | null
          source_register?: string | null
          status?: string
          status_reason?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_findings_accountable_department_id_fkey"
            columns: ["accountable_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "esh_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_organization_id_duplicate_of_finding_id_fkey"
            columns: ["organization_id", "duplicate_of_finding_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_findings_organization_id_duplicate_of_finding_id_fkey"
            columns: ["organization_id", "duplicate_of_finding_id"]
            isOneToOne: false
            referencedRelation: "esh_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_findings_organization_id_duplicate_of_finding_id_fkey"
            columns: ["organization_id", "duplicate_of_finding_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_findings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_reopened_by_fkey"
            columns: ["reopened_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_risk_assessed_by_fkey"
            columns: ["risk_assessed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_risk_assessed_by_fkey"
            columns: ["risk_assessed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_risk_assessed_by_fkey"
            columns: ["risk_assessed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_risk_assessed_by_fkey"
            columns: ["risk_assessed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_findings_risk_assessed_by_fkey"
            columns: ["risk_assessed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_followup_events: {
        Row: {
          action_id: string
          assignment_version: number | null
          created_at: string
          detail: Json
          due_at_snapshot: string | null
          id: string
          kind: string
          organization_id: string
          policy_version: number | null
          stage: number | null
          state: string
          trigger_key: string
        }
        Insert: {
          action_id: string
          assignment_version?: number | null
          created_at?: string
          detail?: Json
          due_at_snapshot?: string | null
          id?: string
          kind: string
          organization_id: string
          policy_version?: number | null
          stage?: number | null
          state?: string
          trigger_key: string
        }
        Update: {
          action_id?: string
          assignment_version?: number | null
          created_at?: string
          detail?: Json
          due_at_snapshot?: string | null
          id?: string
          kind?: string
          organization_id?: string
          policy_version?: number | null
          stage?: number | null
          state?: string
          trigger_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_followup_events_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_followup_policies: {
        Row: {
          catch_up: string
          level_days: number[]
          organization_id: string
          overdue_every_days: number
          pre_due_days: number
          quiet_from: string | null
          quiet_to: string | null
          remind_on_due: boolean
          review_reminder_days: number
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          catch_up?: string
          level_days?: number[]
          organization_id: string
          overdue_every_days?: number
          pre_due_days?: number
          quiet_from?: string | null
          quiet_to?: string | null
          remind_on_due?: boolean
          review_reminder_days?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          catch_up?: string
          level_days?: number[]
          organization_id?: string
          overdue_every_days?: number
          pre_due_days?: number
          quiet_from?: string | null
          quiet_to?: string | null
          remind_on_due?: boolean
          review_reminder_days?: number
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "esh_followup_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_followup_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_followup_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_followup_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_followup_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_followup_policies_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_followup_policy_rules: {
        Row: {
          applies_to: string
          applies_value: string
          id: string
          level_days: number[]
          organization_id: string
          overdue_every_days: number
          pre_due_days: number
          remind_on_due: boolean
          review_reminder_days: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          applies_to: string
          applies_value: string
          id?: string
          level_days: number[]
          organization_id: string
          overdue_every_days: number
          pre_due_days: number
          remind_on_due?: boolean
          review_reminder_days: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          applies_to?: string
          applies_value?: string
          id?: string
          level_days?: number[]
          organization_id?: string
          overdue_every_days?: number
          pre_due_days?: number
          remind_on_due?: boolean
          review_reminder_days?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_followup_policy_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "esh_followup_policies"
            referencedColumns: ["organization_id"]
          },
          {
            foreignKeyName: "esh_followup_policy_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_followup_policy_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_followup_policy_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_followup_policy_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_followup_policy_rules_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_guest_session_actions: {
        Row: {
          action_id: string
          assignment_version: number
          session_id: string
        }
        Insert: {
          action_id: string
          assignment_version: number
          session_id: string
        }
        Update: {
          action_id?: string
          assignment_version?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_guest_session_actions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["action_id"]
          },
          {
            foreignKeyName: "esh_guest_session_actions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_guest_session_actions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_register_export_rows"
            referencedColumns: ["action_id"]
          },
          {
            foreignKeyName: "esh_guest_session_actions_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["action_id"]
          },
          {
            foreignKeyName: "esh_guest_session_actions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "esh_guest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_guest_session_escalations: {
        Row: {
          action_id: string
          assignment_version: number
          level: number
          session_id: string
        }
        Insert: {
          action_id: string
          assignment_version: number
          level: number
          session_id: string
        }
        Update: {
          action_id?: string
          assignment_version?: number
          level?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_guest_session_escalations_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["action_id"]
          },
          {
            foreignKeyName: "esh_guest_session_escalations_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_guest_session_escalations_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_register_export_rows"
            referencedColumns: ["action_id"]
          },
          {
            foreignKeyName: "esh_guest_session_escalations_action_id_fkey"
            columns: ["action_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["action_id"]
          },
          {
            foreignKeyName: "esh_guest_session_escalations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "esh_guest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_guest_sessions: {
        Row: {
          absolute_expires_at: string
          grant_id: string | null
          id: string
          identity_version: number
          inbox_scope: boolean
          issued_at: string
          last_used_at: string
          organization_id: string
          principal_id: string
          revoked_at: string | null
          revoked_reason: string | null
          session_hash: string
        }
        Insert: {
          absolute_expires_at: string
          grant_id?: string | null
          id?: string
          identity_version: number
          inbox_scope?: boolean
          issued_at?: string
          last_used_at?: string
          organization_id: string
          principal_id: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_hash: string
        }
        Update: {
          absolute_expires_at?: string
          grant_id?: string | null
          id?: string
          identity_version?: number
          inbox_scope?: boolean
          issued_at?: string
          last_used_at?: string
          organization_id?: string
          principal_id?: string
          revoked_at?: string | null
          revoked_reason?: string | null
          session_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_guest_sessions_grant_id_fkey"
            columns: ["grant_id"]
            isOneToOne: false
            referencedRelation: "esh_access_grants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_guest_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_guest_sessions_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_import_batches: {
        Row: {
          created_at: string
          created_by: string
          date_convention: string
          discard_reason: string | null
          discarded_at: string | null
          discarded_by: string | null
          header_line: number | null
          id: string
          ignored_rows: number
          mapping: Json
          mapping_version: number
          organization_id: string
          released_at: string | null
          released_by: string | null
          sheet_name: string | null
          sheet_path: string | null
          source_hash: string
          source_name: string
          source_register: string
          source_rows: number
          staged_at: string | null
          state: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          created_by: string
          date_convention?: string
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          header_line?: number | null
          id?: string
          ignored_rows?: number
          mapping?: Json
          mapping_version?: number
          organization_id: string
          released_at?: string | null
          released_by?: string | null
          sheet_name?: string | null
          sheet_path?: string | null
          source_hash: string
          source_name: string
          source_register: string
          source_rows?: number
          staged_at?: string | null
          state?: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string
          date_convention?: string
          discard_reason?: string | null
          discarded_at?: string | null
          discarded_by?: string | null
          header_line?: number | null
          id?: string
          ignored_rows?: number
          mapping?: Json
          mapping_version?: number
          organization_id?: string
          released_at?: string | null
          released_by?: string | null
          sheet_name?: string | null
          sheet_path?: string | null
          source_hash?: string
          source_name?: string
          source_register?: string
          source_rows?: number
          staged_at?: string | null
          state?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_batches_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_batches_discarded_by_fkey"
            columns: ["discarded_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_batches_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_batches_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_batches_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_import_evidence_refs: {
        Row: {
          acknowledged_at: string | null
          acknowledged_by: string | null
          asset_id: string | null
          batch_id: string
          created_at: string
          detail: string
          failure: string | null
          id: string
          kind: string
          organization_id: string
          row_id: string | null
          state: string
        }
        Insert: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_id?: string | null
          batch_id: string
          created_at?: string
          detail: string
          failure?: string | null
          id?: string
          kind: string
          organization_id: string
          row_id?: string | null
          state?: string
        }
        Update: {
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          asset_id?: string | null
          batch_id?: string
          created_at?: string
          detail?: string
          failure?: string | null
          id?: string
          kind?: string
          organization_id?: string
          row_id?: string | null
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_import_evidence_refs_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_evidence_refs_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_evidence_refs_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_evidence_refs_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_evidence_refs_acknowledged_by_fkey"
            columns: ["acknowledged_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_evidence_refs_asset_id_fkey"
            columns: ["asset_id"]
            isOneToOne: false
            referencedRelation: "esh_evidence_assets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_evidence_refs_organization_id_batch_id_fkey"
            columns: ["organization_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "esh_import_batches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_import_evidence_refs_row_id_fkey"
            columns: ["row_id"]
            isOneToOne: false
            referencedRelation: "esh_import_rows"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_import_owner_emails: {
        Row: {
          batch_id: string
          canonical_email: string | null
          decided_at: string
          decided_by: string
          source_name: string
        }
        Insert: {
          batch_id: string
          canonical_email?: string | null
          decided_at?: string
          decided_by: string
          source_name: string
        }
        Update: {
          batch_id?: string
          canonical_email?: string | null
          decided_at?: string
          decided_by?: string
          source_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_import_owner_emails_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "esh_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_owner_emails_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_owner_emails_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_owner_emails_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_owner_emails_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_owner_emails_decided_by_fkey"
            columns: ["decided_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_import_rows: {
        Row: {
          action_id: string | null
          batch_id: string
          created_at: string
          duplicate_of_finding_id: string | null
          finding_id: string | null
          fingerprint: string | null
          id: string
          mapped: Json
          needs_assignment: boolean
          organization_id: string
          outcome: string
          problems: string[]
          raw: Json
          released_at: string | null
          resolution: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          source_line: number
          source_reference: string | null
          updated_at: string
        }
        Insert: {
          action_id?: string | null
          batch_id: string
          created_at?: string
          duplicate_of_finding_id?: string | null
          finding_id?: string | null
          fingerprint?: string | null
          id?: string
          mapped?: Json
          needs_assignment?: boolean
          organization_id: string
          outcome?: string
          problems?: string[]
          raw: Json
          released_at?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_line: number
          source_reference?: string | null
          updated_at?: string
        }
        Update: {
          action_id?: string | null
          batch_id?: string
          created_at?: string
          duplicate_of_finding_id?: string | null
          finding_id?: string | null
          fingerprint?: string | null
          id?: string
          mapped?: Json
          needs_assignment?: boolean
          organization_id?: string
          outcome?: string
          problems?: string[]
          raw?: Json
          released_at?: string | null
          resolution?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          source_line?: number
          source_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_import_rows_finding_fk"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_import_rows_finding_fk"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_import_rows_finding_fk"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_import_rows_organization_id_batch_id_fkey"
            columns: ["organization_id", "batch_id"]
            isOneToOne: false
            referencedRelation: "esh_import_batches"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_import_rows_organization_id_duplicate_of_finding_id_fkey"
            columns: ["organization_id", "duplicate_of_finding_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_import_rows_organization_id_duplicate_of_finding_id_fkey"
            columns: ["organization_id", "duplicate_of_finding_id"]
            isOneToOne: false
            referencedRelation: "esh_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_import_rows_organization_id_duplicate_of_finding_id_fkey"
            columns: ["organization_id", "duplicate_of_finding_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_import_rows_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_rows_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_rows_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_import_rows_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_import_rows_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_notification_outbox: {
        Row: {
          action_id: string | null
          attempts: number
          created_at: string
          escalation_level: number | null
          event_type: string
          finding_id: string | null
          followup_event_id: string | null
          id: string
          idempotency_key: string
          import_batch_id: string | null
          last_error: string | null
          link_intents: Json
          next_attempt_at: string | null
          organization_id: string
          provider_message_id: string | null
          recipient_principal_id: string | null
          recipient_user_id: string | null
          released_at: string | null
          released_by: string | null
          sent_at: string | null
          state: string
          state_reason: string | null
          submission_id: string | null
          updated_at: string
        }
        Insert: {
          action_id?: string | null
          attempts?: number
          created_at?: string
          escalation_level?: number | null
          event_type: string
          finding_id?: string | null
          followup_event_id?: string | null
          id?: string
          idempotency_key: string
          import_batch_id?: string | null
          last_error?: string | null
          link_intents?: Json
          next_attempt_at?: string | null
          organization_id: string
          provider_message_id?: string | null
          recipient_principal_id?: string | null
          recipient_user_id?: string | null
          released_at?: string | null
          released_by?: string | null
          sent_at?: string | null
          state: string
          state_reason?: string | null
          submission_id?: string | null
          updated_at?: string
        }
        Update: {
          action_id?: string | null
          attempts?: number
          created_at?: string
          escalation_level?: number | null
          event_type?: string
          finding_id?: string | null
          followup_event_id?: string | null
          id?: string
          idempotency_key?: string
          import_batch_id?: string | null
          last_error?: string | null
          link_intents?: Json
          next_attempt_at?: string | null
          organization_id?: string
          provider_message_id?: string | null
          recipient_principal_id?: string | null
          recipient_user_id?: string | null
          released_at?: string | null
          released_by?: string | null
          sent_at?: string | null
          state?: string
          state_reason?: string | null
          submission_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_notification_outbox_followup_event_id_fkey"
            columns: ["followup_event_id"]
            isOneToOne: false
            referencedRelation: "esh_followup_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "esh_import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_action_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_findings"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_organization_id_finding_id_fkey"
            columns: ["organization_id", "finding_id"]
            isOneToOne: false
            referencedRelation: "esh_register_rows"
            referencedColumns: ["organization_id", "finding_id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_organization_id_recipient_principa_fkey"
            columns: ["organization_id", "recipient_principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_recipient_user_id_fkey"
            columns: ["recipient_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_released_by_fkey"
            columns: ["released_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_notification_outbox_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: false
            referencedRelation: "esh_action_submissions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_priority_changes: {
        Row: {
          action_id: string
          changed_at: string
          changed_by: string
          from_priority: string | null
          id: string
          organization_id: string
          reason: string
          to_priority: string
        }
        Insert: {
          action_id: string
          changed_at?: string
          changed_by: string
          from_priority?: string | null
          id?: string
          organization_id: string
          reason: string
          to_priority: string
        }
        Update: {
          action_id?: string
          changed_at?: string
          changed_by?: string
          from_priority?: string | null
          id?: string
          organization_id?: string
          reason?: string
          to_priority?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_priority_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_priority_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_priority_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_priority_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_priority_changes_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_priority_changes_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
        ]
      }
      esh_reference_counters: {
        Row: {
          next_value: number
          organization_id: string
        }
        Insert: {
          next_value?: number
          organization_id: string
        }
        Update: {
          next_value?: number
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_reference_counters_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_report_definitions: {
        Row: {
          created_at: string
          created_by: string
          id: string
          include_descendants: boolean
          last_failed_at: string | null
          last_failure: string | null
          name: string
          organization_id: string
          organization_wide: boolean
          schedule_isodow: number
          schedule_local_time: string
          scope_version: number
          state: string
          timezone: string
          updated_at: string
          updated_by: string
          version: number
        }
        Insert: {
          created_at?: string
          created_by: string
          id?: string
          include_descendants?: boolean
          last_failed_at?: string | null
          last_failure?: string | null
          name: string
          organization_id: string
          organization_wide?: boolean
          schedule_isodow?: number
          schedule_local_time?: string
          scope_version?: number
          state?: string
          timezone?: string
          updated_at?: string
          updated_by: string
          version?: number
        }
        Update: {
          created_at?: string
          created_by?: string
          id?: string
          include_descendants?: boolean
          last_failed_at?: string | null
          last_failure?: string | null
          name?: string
          organization_id?: string
          organization_wide?: boolean
          schedule_isodow?: number
          schedule_local_time?: string
          scope_version?: number
          state?: string
          timezone?: string
          updated_at?: string
          updated_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "esh_report_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_report_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_report_definitions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_definitions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_report_definitions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_definitions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_definitions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_report_definitions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_report_departments: {
        Row: {
          department_id: string
          report_definition_id: string
        }
        Insert: {
          department_id: string
          report_definition_id: string
        }
        Update: {
          department_id?: string
          report_definition_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_report_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_departments_report_definition_id_fkey"
            columns: ["report_definition_id"]
            isOneToOne: false
            referencedRelation: "esh_report_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_report_outbox: {
        Row: {
          attempts: number
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          next_attempt_at: string | null
          organization_id: string
          provider_message_id: string | null
          recipient_id: string
          run_id: string
          sent_at: string | null
          state: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id: string
          provider_message_id?: string | null
          recipient_id: string
          run_id: string
          sent_at?: string | null
          state?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          next_attempt_at?: string | null
          organization_id?: string
          provider_message_id?: string | null
          recipient_id?: string
          run_id?: string
          sent_at?: string | null
          state?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_report_outbox_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_outbox_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "esh_report_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_outbox_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "esh_report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_report_recipients: {
        Row: {
          created_at: string
          created_by: string
          enabled: boolean
          entitlement_version: number
          id: string
          organization_id: string
          principal_id: string
          report_definition_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by: string
          enabled?: boolean
          entitlement_version?: number
          id?: string
          organization_id: string
          principal_id: string
          report_definition_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string
          enabled?: boolean
          entitlement_version?: number
          id?: string
          organization_id?: string
          principal_id?: string
          report_definition_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_report_recipients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_report_recipients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_recipients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_recipients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_report_recipients_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_recipients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_recipients_organization_id_principal_id_fkey"
            columns: ["organization_id", "principal_id"]
            isOneToOne: false
            referencedRelation: "esh_email_principals"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_report_recipients_report_definition_id_fkey"
            columns: ["report_definition_id"]
            isOneToOne: false
            referencedRelation: "esh_report_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_report_runs: {
        Row: {
          awaiting_count: number
          captured_at: string
          closed_count: number
          closed_window_end: string
          closed_window_start: string
          cycle_local_date: string
          definition_name: string
          definition_version: number
          failure: string | null
          id: string
          open_count: number
          organization_id: string
          overdue_count: number
          report_definition_id: string
          scope_version: number
          state: string
          timezone: string
        }
        Insert: {
          awaiting_count?: number
          captured_at?: string
          closed_count?: number
          closed_window_end: string
          closed_window_start: string
          cycle_local_date: string
          definition_name: string
          definition_version: number
          failure?: string | null
          id?: string
          open_count?: number
          organization_id: string
          overdue_count?: number
          report_definition_id: string
          scope_version: number
          state?: string
          timezone: string
        }
        Update: {
          awaiting_count?: number
          captured_at?: string
          closed_count?: number
          closed_window_end?: string
          closed_window_start?: string
          cycle_local_date?: string
          definition_name?: string
          definition_version?: number
          failure?: string | null
          id?: string
          open_count?: number
          organization_id?: string
          overdue_count?: number
          report_definition_id?: string
          scope_version?: number
          state?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_report_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_runs_report_definition_id_fkey"
            columns: ["report_definition_id"]
            isOneToOne: false
            referencedRelation: "esh_report_definitions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_report_session_entitlements: {
        Row: {
          definition_version: number
          entitlement_version: number
          recipient_id: string
          run_id: string
          scope_version: number
          session_id: string
        }
        Insert: {
          definition_version: number
          entitlement_version: number
          recipient_id: string
          run_id: string
          scope_version: number
          session_id: string
        }
        Update: {
          definition_version?: number
          entitlement_version?: number
          recipient_id?: string
          run_id?: string
          scope_version?: number
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_report_session_entitlements_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "esh_report_recipients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_session_entitlements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "esh_report_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_session_entitlements_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "esh_guest_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_report_snapshot_rows: {
        Row: {
          action_id: string | null
          action_state: string | null
          action_title: string | null
          closed_at: string | null
          department_id: string | null
          department_name: string | null
          due_at: string | null
          due_is_date_only: boolean | null
          finding_id: string
          finding_title: string
          id: string
          last_update_at: string | null
          location: string | null
          owner_email: string | null
          reference: string
          run_id: string
          signal: string
        }
        Insert: {
          action_id?: string | null
          action_state?: string | null
          action_title?: string | null
          closed_at?: string | null
          department_id?: string | null
          department_name?: string | null
          due_at?: string | null
          due_is_date_only?: boolean | null
          finding_id: string
          finding_title: string
          id?: string
          last_update_at?: string | null
          location?: string | null
          owner_email?: string | null
          reference: string
          run_id: string
          signal: string
        }
        Update: {
          action_id?: string | null
          action_state?: string | null
          action_title?: string | null
          closed_at?: string | null
          department_id?: string | null
          department_name?: string | null
          due_at?: string | null
          due_is_date_only?: boolean | null
          finding_id?: string
          finding_title?: string
          id?: string
          last_update_at?: string | null
          location?: string | null
          owner_email?: string | null
          reference?: string
          run_id?: string
          signal?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_report_snapshot_rows_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_report_snapshot_rows_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "esh_report_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_rollout_settings: {
        Row: {
          authorization_version: number
          bootstrap_email: string
          bootstrap_outcome: string
          bootstrap_user_id: string | null
          initialized_at: string
          mode: string
          mode_changed_at: string | null
          mode_changed_by: string | null
          mode_reason: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          authorization_version?: number
          bootstrap_email: string
          bootstrap_outcome: string
          bootstrap_user_id?: string | null
          initialized_at?: string
          mode?: string
          mode_changed_at?: string | null
          mode_changed_by?: string | null
          mode_reason?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          authorization_version?: number
          bootstrap_email?: string
          bootstrap_outcome?: string
          bootstrap_user_id?: string | null
          initialized_at?: string
          mode?: string
          mode_changed_at?: string | null
          mode_changed_by?: string | null
          mode_reason?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_rollout_settings_bootstrap_user_id_fkey"
            columns: ["bootstrap_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_bootstrap_user_id_fkey"
            columns: ["bootstrap_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_bootstrap_user_id_fkey"
            columns: ["bootstrap_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_bootstrap_user_id_fkey"
            columns: ["bootstrap_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_bootstrap_user_id_fkey"
            columns: ["bootstrap_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_mode_changed_by_fkey"
            columns: ["mode_changed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_mode_changed_by_fkey"
            columns: ["mode_changed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_mode_changed_by_fkey"
            columns: ["mode_changed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_mode_changed_by_fkey"
            columns: ["mode_changed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_mode_changed_by_fkey"
            columns: ["mode_changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_rollout_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_staff_access: {
        Row: {
          authorization_version: number
          can_manage_reports: boolean
          created_at: string
          disabled_at: string | null
          disabled_by: string | null
          enabled: boolean
          enabled_at: string | null
          enabled_by: string | null
          id: string
          organization_id: string
          preset: string
          scope_all_departments: boolean
          updated_at: string
          updated_by: string | null
          user_id: string
        }
        Insert: {
          authorization_version?: number
          can_manage_reports?: boolean
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          id?: string
          organization_id: string
          preset?: string
          scope_all_departments?: boolean
          updated_at?: string
          updated_by?: string | null
          user_id: string
        }
        Update: {
          authorization_version?: number
          can_manage_reports?: boolean
          created_at?: string
          disabled_at?: string | null
          disabled_by?: string | null
          enabled?: boolean
          enabled_at?: string | null
          enabled_by?: string | null
          id?: string
          organization_id?: string
          preset?: string
          scope_all_departments?: boolean
          updated_at?: string
          updated_by?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_staff_access_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_disabled_by_fkey"
            columns: ["disabled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_enabled_by_fkey"
            columns: ["enabled_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_staff_access_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_staff_access_departments: {
        Row: {
          access_id: string
          department_id: string
          include_descendants: boolean
        }
        Insert: {
          access_id: string
          department_id: string
          include_descendants?: boolean
        }
        Update: {
          access_id?: string
          department_id?: string
          include_descendants?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "esh_staff_access_departments_access_id_fkey"
            columns: ["access_id"]
            isOneToOne: false
            referencedRelation: "esh_staff_access"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_staff_access_departments_department_id_fkey"
            columns: ["department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_verification_events: {
        Row: {
          action_id: string
          decision: string
          due_decision: string | null
          id: string
          method: string | null
          note: string | null
          organization_id: string
          submission_id: string
          verified_at: string
          verifier_user_id: string
        }
        Insert: {
          action_id: string
          decision: string
          due_decision?: string | null
          id?: string
          method?: string | null
          note?: string | null
          organization_id: string
          submission_id: string
          verified_at?: string
          verifier_user_id: string
        }
        Update: {
          action_id?: string
          decision?: string
          due_decision?: string | null
          id?: string
          method?: string | null
          note?: string | null
          organization_id?: string
          submission_id?: string
          verified_at?: string
          verifier_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_verification_events_organization_id_action_id_fkey"
            columns: ["organization_id", "action_id"]
            isOneToOne: false
            referencedRelation: "esh_finding_actions"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "esh_verification_events_submission_id_fkey"
            columns: ["submission_id"]
            isOneToOne: true
            referencedRelation: "esh_action_submissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_verification_events_verifier_user_id_fkey"
            columns: ["verifier_user_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_verification_events_verifier_user_id_fkey"
            columns: ["verifier_user_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_verification_events_verifier_user_id_fkey"
            columns: ["verifier_user_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_verification_events_verifier_user_id_fkey"
            columns: ["verifier_user_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_verification_events_verifier_user_id_fkey"
            columns: ["verifier_user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_worker_runs: {
        Row: {
          detail: Json
          id: string
          ok: boolean
          organization_id: string
          ran_at: string
          worker: string
        }
        Insert: {
          detail?: Json
          id?: string
          ok: boolean
          organization_id: string
          ran_at?: string
          worker: string
        }
        Update: {
          detail?: Json
          id?: string
          ok?: boolean
          organization_id?: string
          ran_at?: string
          worker?: string
        }
        Relationships: [
          {
            foreignKeyName: "esh_worker_runs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_working_calendar_exceptions: {
        Row: {
          calendar_date: string
          is_working_day: boolean
          label: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          calendar_date: string
          is_working_day: boolean
          label: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          calendar_date?: string
          is_working_day?: boolean
          label?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_working_calendar_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_working_calendar_exceptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_working_calendar_exceptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_working_calendar_exceptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_working_calendar_exceptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_working_calendar_exceptions_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_working_calendars: {
        Row: {
          confirmed_through: string | null
          organization_id: string
          updated_at: string
          updated_by: string | null
          working_weekdays: number[]
        }
        Insert: {
          confirmed_through?: string | null
          organization_id: string
          updated_at?: string
          updated_by?: string | null
          working_weekdays?: number[]
        }
        Update: {
          confirmed_through?: string | null
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
          working_weekdays?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "esh_working_calendars_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_working_calendars_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_working_calendars_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_working_calendars_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_working_calendars_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "esh_working_calendars_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
      identity_module_access_migrations: {
        Row: {
          focus_access_preset: string
          migrated_at: string
          migration_version: string
          platform_administrator: boolean
          previous_role: Database["public"]["Enums"]["app_role"]
          reviewed: boolean
          user_id: string
        }
        Insert: {
          focus_access_preset: string
          migrated_at?: string
          migration_version?: string
          platform_administrator: boolean
          previous_role: Database["public"]["Enums"]["app_role"]
          reviewed?: boolean
          user_id: string
        }
        Update: {
          focus_access_preset?: string
          migrated_at?: string
          migration_version?: string
          platform_administrator?: boolean
          previous_role?: Database["public"]["Enums"]["app_role"]
          reviewed?: boolean
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "identity_module_access_migrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "identity_module_access_migrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_module_access_migrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "identity_module_access_migrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "identity_module_access_migrations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "user_profiles"
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
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          timezone: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          timezone?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          timezone?: string
        }
        Relationships: []
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
      reporting_assignments: {
        Row: {
          changed_at: string
          changed_by: string | null
          effective_date: string
          id: string
          new_manager_id: string | null
          previous_manager_id: string | null
          reason: string | null
          relationship: string
          subject_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          effective_date?: string
          id?: string
          new_manager_id?: string | null
          previous_manager_id?: string | null
          reason?: string | null
          relationship?: string
          subject_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          effective_date?: string
          id?: string
          new_manager_id?: string | null
          previous_manager_id?: string | null
          reason?: string | null
          relationship?: string
          subject_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reporting_assignments_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_new_manager_id_fkey"
            columns: ["new_manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_new_manager_id_fkey"
            columns: ["new_manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_new_manager_id_fkey"
            columns: ["new_manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_new_manager_id_fkey"
            columns: ["new_manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_new_manager_id_fkey"
            columns: ["new_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_previous_manager_id_fkey"
            columns: ["previous_manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_previous_manager_id_fkey"
            columns: ["previous_manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_previous_manager_id_fkey"
            columns: ["previous_manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_previous_manager_id_fkey"
            columns: ["previous_manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_previous_manager_id_fkey"
            columns: ["previous_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reporting_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "reporting_assignments_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      task_overdue_notices: {
        Row: {
          due_at: string
          notification_id: string | null
          notified_at: string
          recipient_id: string
          task_id: string
        }
        Insert: {
          due_at: string
          notification_id?: string | null
          notified_at?: string
          recipient_id: string
          task_id: string
        }
        Update: {
          due_at?: string
          notification_id?: string | null
          notified_at?: string
          recipient_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_overdue_notices_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "notifications"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_overdue_notices_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_overdue_notices_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_overdue_notices_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_overdue_notices_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_overdue_notices_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_overdue_notices_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_overdue_notices_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_overdue_notices_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_overdue_notices_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
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
      task_update_requests: {
        Row: {
          checklist_item_id: string | null
          id: string
          last_asked_at: string
          message: string | null
          requested_at: string
          requested_by: string
          requested_of: string
          resolution: string | null
          resolved_at: string | null
          task_id: string
          times_asked: number
          update_id: string | null
        }
        Insert: {
          checklist_item_id?: string | null
          id?: string
          last_asked_at?: string
          message?: string | null
          requested_at?: string
          requested_by: string
          requested_of: string
          resolution?: string | null
          resolved_at?: string | null
          task_id: string
          times_asked?: number
          update_id?: string | null
        }
        Update: {
          checklist_item_id?: string | null
          id?: string
          last_asked_at?: string
          message?: string | null
          requested_at?: string
          requested_by?: string
          requested_of?: string
          resolution?: string | null
          resolved_at?: string | null
          task_id?: string
          times_asked?: number
          update_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "task_update_requests_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "completed_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "task_update_requests_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "shared_contributions"
            referencedColumns: ["checklist_item_id"]
          },
          {
            foreignKeyName: "task_update_requests_checklist_item_id_fkey"
            columns: ["checklist_item_id"]
            isOneToOne: false
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_of_fkey"
            columns: ["requested_of"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_of_fkey"
            columns: ["requested_of"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_of_fkey"
            columns: ["requested_of"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_of_fkey"
            columns: ["requested_of"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "task_update_requests_requested_of_fkey"
            columns: ["requested_of"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "binned_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "routine_occurrence_outcomes"
            referencedColumns: ["task_id"]
          },
          {
            foreignKeyName: "task_update_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "task_overview"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "task_update_requests_update_id_fkey"
            columns: ["update_id"]
            isOneToOne: false
            referencedRelation: "task_updates"
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
          focus_access_preset: string
          full_name: string
          functional_manager_id: string | null
          id: string
          job_title: string | null
          personal_summary_mode: Database["public"]["Enums"]["personal_summary_mode"]
          platform_administrator: boolean
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
          focus_access_preset?: string
          full_name: string
          functional_manager_id?: string | null
          id: string
          job_title?: string | null
          personal_summary_mode?: Database["public"]["Enums"]["personal_summary_mode"]
          platform_administrator?: boolean
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
          focus_access_preset?: string
          full_name?: string
          functional_manager_id?: string | null
          id?: string
          job_title?: string | null
          personal_summary_mode?: Database["public"]["Enums"]["personal_summary_mode"]
          platform_administrator?: boolean
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
            foreignKeyName: "user_profiles_functional_manager_id_fkey"
            columns: ["functional_manager_id"]
            isOneToOne: false
            referencedRelation: "focus_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_functional_manager_id_fkey"
            columns: ["functional_manager_id"]
            isOneToOne: false
            referencedRelation: "person_display"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_functional_manager_id_fkey"
            columns: ["functional_manager_id"]
            isOneToOne: false
            referencedRelation: "team_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_profiles_functional_manager_id_fkey"
            columns: ["functional_manager_id"]
            isOneToOne: false
            referencedRelation: "team_load_summary"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_profiles_functional_manager_id_fkey"
            columns: ["functional_manager_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
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
      esh_action_register_rows: {
        Row: {
          accountable_department_id: string | null
          action_count: number | null
          action_id: string | null
          action_sequence: number | null
          action_state: string | null
          action_title: string | null
          baseline_due_at: string | null
          changes_requested: boolean | null
          closed_at: string | null
          created_at: string | null
          department_name: string | null
          due_at: string | null
          due_is_date_only: boolean | null
          finding_id: string | null
          is_overdue: boolean | null
          is_restricted: boolean | null
          last_update_at: string | null
          last_update_type: string | null
          location: string | null
          needs_attention: boolean | null
          notification_failed: boolean | null
          notification_held: boolean | null
          organization_id: string | null
          owner_email: string | null
          priority: string | null
          reference: string | null
          risk_level: string | null
          status: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_findings_accountable_department_id_fkey"
            columns: ["accountable_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      esh_admin_contact_relationships: {
        Row: {
          action_id: string | null
          action_title: string | null
          activated: boolean | null
          due_at: string | null
          escalation_level: number | null
          participation: string | null
          principal_id: string | null
          reference: string | null
          state: string | null
          title: string | null
        }
        Relationships: []
      }
      esh_register_export_rows: {
        Row: {
          accountable_department: string | null
          action_id: string | null
          action_sequence: number | null
          action_state: string | null
          action_title: string | null
          active_escalations: number | null
          after_description: string | null
          baseline_due_at: string | null
          before_description: string | null
          closed_at: string | null
          current_due_at: string | null
          escalation_recipients: number | null
          escalation_state: string | null
          finding_id: string | null
          finding_status: string | null
          finding_title: string | null
          location: string | null
          owner_email: string | null
          priority: string | null
          reference: string | null
          reported_on: string | null
          required_outcome: string | null
          risk_level: string | null
          submitted_at: string | null
          verified_at: string | null
        }
        Relationships: []
      }
      esh_register_rows: {
        Row: {
          accountable_department_id: string | null
          action_count: number | null
          action_id: string | null
          action_state: string | null
          changes_requested: boolean | null
          closed_at: string | null
          created_at: string | null
          department_name: string | null
          due_at: string | null
          due_is_date_only: boolean | null
          escalation_level: number | null
          finding_id: string | null
          is_overdue: boolean | null
          is_restricted: boolean | null
          last_update_at: string | null
          last_update_type: string | null
          location: string | null
          needs_attention: boolean | null
          notification_failed: boolean | null
          notification_held: boolean | null
          organization_id: string | null
          owner_email: string | null
          priority: string | null
          reference: string | null
          risk_level: string | null
          status: string | null
          title: string | null
        }
        Relationships: [
          {
            foreignKeyName: "esh_findings_accountable_department_id_fkey"
            columns: ["accountable_department_id"]
            isOneToOne: false
            referencedRelation: "departments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "esh_findings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          next_own_step_due_at: string | null
          occurrence_date: string | null
          open_barrier_count: number | null
          origin: Database["public"]["Enums"]["work_origin"] | null
          over_focus_target: boolean | null
          own_step_overdue_count: number | null
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
      apply_organisation_import: {
        Args: {
          p_effective_date?: string
          p_expected_changes: number
          p_reason?: string
          p_rows: Json
        }
        Returns: Json
      }
      assign_work_to_people: {
        Args: {
          p_capture_id?: string
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
      change_functional_manager: {
        Args: {
          p_effective_date?: string
          p_manager_id?: string
          p_reason?: string
          p_user_id: string
        }
        Returns: Json
      }
      change_reporting_manager: {
        Args: {
          p_effective_date?: string
          p_manager_id?: string
          p_reason?: string
          p_user_id: string
        }
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
      create_department: {
        Args: {
          p_code: string
          p_head_id?: string
          p_name: string
          p_parent_id?: string
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
      esh_admin_contact_access_items: {
        Args: { p_principal_id: string }
        Returns: {
          action_id: string
          expires_at: string
          id: string
          kind: string
          purpose: string
          started_at: string
        }[]
      }
      esh_admin_contacts: {
        Args: { p_search: string }
        Returns: {
          access_changed_at: string
          access_changed_by: string
          access_enabled: boolean
          access_reason: string
          active_escalations: number
          configured_escalations: number
          created_at: string
          display_email: string
          display_name: string
          failed_notifications: number
          held_notifications: number
          id: string
          last_access_at: string
          open_actions: number
          report_subscriptions: number
          staff_user_id: string
          status: string
        }[]
      }
      esh_admin_correct_contact_email: {
        Args: {
          p_new_email: string
          p_principal_id: string
          p_reason: string
          p_transfer_actions: boolean
          p_transfer_escalations: boolean
        }
        Returns: Json
      }
      esh_admin_disable_contact: {
        Args: { p_principal_id: string; p_reason: string }
        Returns: Json
      }
      esh_admin_resend_contact_access: {
        Args: {
          p_action_id?: string
          p_principal_id: string
          p_purpose: string
          p_reason?: string
        }
        Returns: Json
      }
      esh_admin_revoke_contact_access: {
        Args: {
          p_access_id: string
          p_kind: string
          p_principal_id: string
          p_reason: string
        }
        Returns: Json
      }
      esh_build_digests: { Args: { p_now?: string }; Returns: Json }
      esh_change_due: {
        Args: {
          p_action_id: string
          p_due_date: string
          p_due_time: string
          p_reason: string
        }
        Returns: Json
      }
      esh_current_access: { Args: never; Returns: Json }
      esh_dashboard: { Args: { p_months?: number }; Returns: Json }
      esh_digest_prepare: { Args: { p_outbox_id: string }; Returns: Json }
      esh_dispatch_claim: {
        Args: { p_outbox_id: string; p_secrets: Json }
        Returns: Json
      }
      esh_dispatch_complete: {
        Args: {
          p_error?: string
          p_ok: boolean
          p_outbox_id: string
          p_permanent?: boolean
          p_provider_message_id?: string
        }
        Returns: Json
      }
      esh_edit_finding: {
        Args: {
          p_department_id: string
          p_description: string
          p_finding_id: string
          p_location: string
          p_title: string
        }
        Returns: Json
      }
      esh_finish_upload: {
        Args: {
          p_asset_id: string
          p_ok: boolean
          p_reason: string
          p_sha256: string
          p_size: number
          p_type: string
        }
        Returns: Json
      }
      esh_generate_weekly_reports: { Args: { p_now?: string }; Returns: Json }
      esh_guest_acknowledge: {
        Args: { p_action_id: string; p_session: string }
        Returns: Json
      }
      esh_guest_action: {
        Args: { p_action_id: string; p_before?: string; p_session: string }
        Returns: Json
      }
      esh_guest_bulk_extension: {
        Args: {
          p_action_ids: string[]
          p_body: string
          p_operation_key: string
          p_proposed_date: string
          p_session: string
        }
        Returns: Json
      }
      esh_guest_bulk_submit: {
        Args: { p_operation_key: string; p_rows: Json; p_session: string }
        Returns: Json
      }
      esh_guest_bulk_update: {
        Args: {
          p_action_ids: string[]
          p_body: string
          p_operation_key: string
          p_session: string
        }
        Returns: Json
      }
      esh_guest_end_session: { Args: { p_session: string }; Returns: Json }
      esh_guest_exchange: {
        Args: {
          p_challenge: string
          p_consume: boolean
          p_existing_session: string
          p_new_session: string
          p_token: string
        }
        Returns: Json
      }
      esh_guest_file: {
        Args: { p_asset_id: string; p_session: string }
        Returns: Json
      }
      esh_guest_finish_upload: {
        Args: {
          p_asset_id: string
          p_ok: boolean
          p_reason: string
          p_session: string
          p_sha256: string
          p_size: number
          p_type: string
        }
        Returns: Json
      }
      esh_guest_my_actions: {
        Args: {
          p_filter: string
          p_limit: number
          p_offset: number
          p_search: string
          p_session: string
        }
        Returns: Json
      }
      esh_guest_remove_upload: {
        Args: { p_asset_id: string; p_session: string }
        Returns: Json
      }
      esh_guest_report: {
        Args: { p_live?: boolean; p_run_id: string; p_session: string }
        Returns: Json
      }
      esh_guest_request_link: {
        Args: {
          p_email: string
          p_organization_slug: string
          p_session: string
          p_token: string
        }
        Returns: Json
      }
      esh_guest_send_message: {
        Args: {
          p_action_id: string
          p_asset_ids?: string[]
          p_body: string
          p_bulk_operation_id?: string
          p_client_key: string
          p_proposed_due_date?: string
          p_proposed_owner_email?: string
          p_session: string
        }
        Returns: Json
      }
      esh_guest_share_finish: {
        Args: { p_arrived: string[]; p_operation_id: string; p_session: string }
        Returns: Json
      }
      esh_guest_share_prepare: {
        Args: {
          p_action_ids: string[]
          p_asset_id: string
          p_operation_key: string
          p_session: string
        }
        Returns: Json
      }
      esh_guest_start_upload: {
        Args: {
          p_action_id: string
          p_name: string
          p_session: string
          p_size: number
        }
        Returns: Json
      }
      esh_guest_submit: {
        Args: {
          p_action_id: string
          p_asset_ids: string[]
          p_body: string
          p_client_key: string
          p_reuse_message_id: string
          p_session: string
        }
        Returns: Json
      }
      esh_guest_upload_target: {
        Args: { p_asset_id: string; p_session: string }
        Returns: Json
      }
      esh_guest_withdraw: {
        Args: { p_action_id: string; p_reason: string; p_session: string }
        Returns: Json
      }
      esh_import_acknowledge_evidence: {
        Args: { p_note: string; p_ref_id: string }
        Returns: Json
      }
      esh_import_amend_row: {
        Args: { p_patch: Json; p_row_id: string }
        Returns: Json
      }
      esh_import_discard: {
        Args: { p_batch_id: string; p_reason: string }
        Returns: Json
      }
      esh_import_reconciliation: { Args: { p_batch_id: string }; Returns: Json }
      esh_import_release: {
        Args: {
          p_batch_id: string
          p_followup_from: string
          p_idempotency_key?: string
          p_row_ids: string[]
        }
        Returns: Json
      }
      esh_import_resolve_row: {
        Args: { p_note: string; p_resolution: string; p_row_id: string }
        Returns: Json
      }
      esh_import_set_owner_email: {
        Args: { p_batch_id: string; p_email: string; p_source_name: string }
        Returns: Json
      }
      esh_import_stage: {
        Args: { p_batch_id: string; p_rows: Json }
        Returns: Json
      }
      esh_import_start: {
        Args: {
          p_date_convention: string
          p_header_line: number
          p_mapping: Json
          p_sheet_name: string
          p_sheet_path: string
          p_source_hash: string
          p_source_name: string
          p_source_register: string
          p_source_rows: number
          p_storage_path: string
        }
        Returns: Json
      }
      esh_list_verifiers: {
        Args: never
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      esh_operational_health: { Args: never; Returns: Json }
      esh_overview: {
        Args: {
          p_as_of?: string
          p_closed_since: string
          p_closed_until?: string
          p_department_id: string
        }
        Returns: {
          accountable_department_id: string
          awaiting_review_actions: number
          closed_findings: number
          department_name: string
          open_findings: number
          overdue_actions: number
          review_overdue_actions: number
        }[]
      }
      esh_post_message: {
        Args: {
          p_action_id: string
          p_asset_ids?: string[]
          p_body: string
          p_client_key: string
        }
        Returns: Json
      }
      esh_preview_report: { Args: { p_definition_id: string }; Returns: Json }
      esh_public_dashboard: { Args: never; Returns: Json }
      esh_reassign_action: {
        Args: { p_action_id: string; p_owner_email: string; p_reason: string }
        Returns: Json
      }
      esh_record_delivery_event: {
        Args: {
          p_detail?: string
          p_event_type: string
          p_occurred_at: string
          p_provider_event_id: string
          p_provider_message_id: string
        }
        Returns: Json
      }
      esh_record_worker_run: {
        Args: { p_detail?: Json; p_ok: boolean; p_worker: string }
        Returns: Json
      }
      esh_release_held_notifications: {
        Args: { p_import_batch_id?: string; p_limit?: number }
        Returns: Json
      }
      esh_release_notification: { Args: { p_outbox_id: string }; Returns: Json }
      esh_remove_upload: { Args: { p_asset_id: string }; Returns: Json }
      esh_reopen_finding: {
        Args: {
          p_due_date: string
          p_due_time: string
          p_finding_id: string
          p_reason: string
        }
        Returns: Json
      }
      esh_report_dispatch_claim: {
        Args: { p_outbox_id: string; p_secret: string }
        Returns: Json
      }
      esh_report_dispatch_complete: {
        Args: {
          p_error?: string
          p_ok: boolean
          p_outbox_id: string
          p_permanent?: boolean
          p_provider_message_id?: string
        }
        Returns: Json
      }
      esh_report_guest_exchange: {
        Args: { p_consume: boolean; p_new_session: string; p_token: string }
        Returns: Json
      }
      esh_report_request_link: {
        Args: { p_email: string; p_organization_slug: string; p_token: string }
        Returns: Json
      }
      esh_resolve_finding: {
        Args: {
          p_duplicate_of?: string
          p_finding_id: string
          p_outcome: string
          p_reason: string
        }
        Returns: Json
      }
      esh_rollout_status: { Args: never; Returns: Json }
      esh_run_followups: { Args: { p_now?: string }; Returns: Json }
      esh_save_finding: {
        Args: {
          p_assign?: boolean
          p_finding_id: string
          p_idempotency_key?: string
          p_payload: Json
        }
        Returns: Json
      }
      esh_save_report_definition: {
        Args: {
          p_department_ids: string[]
          p_id: string
          p_include_descendants: boolean
          p_name: string
          p_organization_wide: boolean
          p_recipient_emails: string[]
          p_schedule_isodow: number
          p_schedule_local_time: string
          p_state: string
          p_timezone: string
        }
        Returns: Json
      }
      esh_set_contact_access: {
        Args: { p_enabled: boolean; p_principal_id: string; p_reason: string }
        Returns: Json
      }
      esh_set_department_escalation: {
        Args: { p_department_id: string; p_levels: Json }
        Returns: Json
      }
      esh_set_followup_policy: {
        Args: {
          p_level_days: number[]
          p_overdue_every_days: number
          p_pre_due_days: number
          p_remind_on_due: boolean
          p_review_reminder_days: number
        }
        Returns: Json
      }
      esh_set_followup_quiet_hours: {
        Args: { p_catch_up: string; p_quiet_from: string; p_quiet_to: string }
        Returns: Json
      }
      esh_set_followup_rule: {
        Args: {
          p_applies_to: string
          p_applies_value: string
          p_level_days: number[]
          p_overdue_every_days: number
          p_pre_due_days: number
          p_remind_on_due: boolean
          p_remove?: boolean
          p_review_reminder_days: number
        }
        Returns: Json
      }
      esh_set_priority: {
        Args: { p_action_id: string; p_priority: string; p_reason: string }
        Returns: Json
      }
      esh_set_risk: {
        Args: { p_finding_id: string; p_reason: string; p_risk: string }
        Returns: Json
      }
      esh_set_rollout_mode: {
        Args: { p_mode: string; p_reason: string }
        Returns: Json
      }
      esh_set_staff_access: {
        Args: {
          p_can_manage_reports?: boolean
          p_department_ids: string[]
          p_enabled: boolean
          p_include_descendants?: boolean
          p_preset: string
          p_reason?: string
          p_scope_all: boolean
          p_user_id: string
        }
        Returns: Json
      }
      esh_set_working_calendar: {
        Args: {
          p_confirmed_through: string
          p_exceptions: Json
          p_working_weekdays: number[]
        }
        Returns: Json
      }
      esh_start_upload: {
        Args: {
          p_action_id: string
          p_finding_id: string
          p_name: string
          p_purpose: string
          p_size: number
        }
        Returns: Json
      }
      esh_verify_submission: {
        Args: {
          p_decision: string
          p_due_date: string
          p_due_time: string
          p_keep_due: boolean
          p_method: string
          p_note: string
          p_submission_id: string
        }
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
      get_task_update_requests: { Args: { p_task_id: string }; Returns: Json }
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
      notify_overdue_work: { Args: { p_task_ids?: string[] }; Returns: Json }
      notify_steps_due_tomorrow: {
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
      preview_organisation_import: { Args: { p_rows: Json }; Returns: Json }
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
          p_job_title?: string
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
      request_task_update: {
        Args: {
          p_checklist_item_id?: string
          p_idempotency_key?: string
          p_message?: string
          p_task_id: string
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
      set_person_module_access: {
        Args: {
          p_focus_preset: string
          p_platform_administrator: boolean
          p_reason: string
          p_user_id: string
        }
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
      update_department: {
        Args: {
          p_clear_head?: boolean
          p_clear_parent?: boolean
          p_code?: string
          p_department_id: string
          p_head_id?: string
          p_name?: string
          p_parent_id?: string
          p_status?: Database["public"]["Enums"]["department_status"]
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
          p_clear_reporting_manager?: boolean
          p_department_id?: string
          p_email?: string
          p_full_name?: string
          p_job_title?: string
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
        | "update_requested"
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
      department_status: "active" | "archived"
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
        | "update_requested"
        | "update_request_answered"
        | "work_overdue"
        | "due_date_changed"
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
        "update_requested",
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
      department_status: ["active", "archived"],
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
        "update_requested",
        "update_request_answered",
        "work_overdue",
        "due_date_changed",
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

