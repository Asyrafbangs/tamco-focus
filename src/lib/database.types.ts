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
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
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
      barriers: {
        Row: {
          add_to_meeting_queue: boolean
          description: string
          id: string
          impact: Database["public"]["Enums"]["barrier_impact"]
          raised_at: string
          raised_by: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["barrier_status"]
          support_needed: string
          task_id: string
        }
        Insert: {
          add_to_meeting_queue?: boolean
          description: string
          id?: string
          impact: Database["public"]["Enums"]["barrier_impact"]
          raised_at?: string
          raised_by: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["barrier_status"]
          support_needed: string
          task_id: string
        }
        Update: {
          add_to_meeting_queue?: boolean
          description?: string
          id?: string
          impact?: Database["public"]["Enums"]["barrier_impact"]
          raised_at?: string
          raised_by?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["barrier_status"]
          support_needed?: string
          task_id?: string
        }
        Relationships: [
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
      meeting_queue_items: {
        Row: {
          barrier_id: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          decision: string | null
          decision_due_at: string | null
          decision_owner_id: string | null
          id: string
          source: Database["public"]["Enums"]["meeting_item_source"]
          status: Database["public"]["Enums"]["meeting_item_status"]
          summary: string
          task_id: string | null
        }
        Insert: {
          barrier_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_due_at?: string | null
          decision_owner_id?: string | null
          id?: string
          source: Database["public"]["Enums"]["meeting_item_source"]
          status?: Database["public"]["Enums"]["meeting_item_status"]
          summary: string
          task_id?: string | null
        }
        Update: {
          barrier_id?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          decision?: string | null
          decision_due_at?: string | null
          decision_owner_id?: string | null
          id?: string
          source?: Database["public"]["Enums"]["meeting_item_source"]
          status?: Database["public"]["Enums"]["meeting_item_status"]
          summary?: string
          task_id?: string | null
        }
        Relationships: [
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
      notifications: {
        Row: {
          actor_id: string | null
          barrier_id: string | null
          body: string
          channel: Database["public"]["Enums"]["notification_channel"]
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
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
          id?: string
          kind: Database["public"]["Enums"]["notification_kind"]
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
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
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
            referencedRelation: "barriers"
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
            referencedRelation: "routine_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      routine_templates: {
        Row: {
          created_at: string
          created_by: string
          day_of_month: number | null
          default_owner_id: string
          description: string | null
          due_time: string
          evidence_required: boolean
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          generated_through: string | null
          id: string
          interval_count: number
          is_active: boolean
          requires_completion_review: boolean
          title: string
          updated_at: string
          weekday: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          day_of_month?: number | null
          default_owner_id: string
          description?: string | null
          due_time?: string
          evidence_required?: boolean
          frequency: Database["public"]["Enums"]["recurrence_frequency"]
          generated_through?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          requires_completion_review?: boolean
          title: string
          updated_at?: string
          weekday?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          day_of_month?: number | null
          default_owner_id?: string
          description?: string | null
          due_time?: string
          evidence_required?: boolean
          frequency?: Database["public"]["Enums"]["recurrence_frequency"]
          generated_through?: string | null
          id?: string
          interval_count?: number
          is_active?: boolean
          requires_completion_review?: boolean
          title?: string
          updated_at?: string
          weekday?: number | null
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
        ]
      }
      task_checklist_items: {
        Row: {
          action: string
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
            referencedRelation: "task_checklist_items"
            referencedColumns: ["id"]
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
            referencedRelation: "barriers"
            referencedColumns: ["id"]
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
          cancelled_at: string | null
          completed_at: string | null
          created_at: string
          created_by: string
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
          review_at: string | null
          review_status: Database["public"]["Enums"]["review_status"]
          reviewer_id: string | null
          routine_template_id: string | null
          state_entered_at: string
          status: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at: string
          urgency: Database["public"]["Enums"]["urgency_level"]
          version: number
          work_class: Database["public"]["Enums"]["work_class"]
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason_code?:
            | Database["public"]["Enums"]["activation_reason"]
            | null
          activation_reason_note?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
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
          review_at?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewer_id?: string | null
          routine_template_id?: string | null
          state_entered_at?: string
          status?: Database["public"]["Enums"]["task_status"]
          title: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
          version?: number
          work_class: Database["public"]["Enums"]["work_class"]
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          activation_reason_code?:
            | Database["public"]["Enums"]["activation_reason"]
            | null
          activation_reason_note?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
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
          review_at?: string | null
          review_status?: Database["public"]["Enums"]["review_status"]
          reviewer_id?: string | null
          routine_template_id?: string | null
          state_entered_at?: string
          status?: Database["public"]["Enums"]["task_status"]
          title?: string
          updated_at?: string
          urgency?: Database["public"]["Enums"]["urgency_level"]
          version?: number
          work_class?: Database["public"]["Enums"]["work_class"]
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
          status: Database["public"]["Enums"]["account_status"]
          team_summary_mode: Database["public"]["Enums"]["team_summary_mode"]
          text_size: string
          theme_preference: string
          timezone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
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
          status?: Database["public"]["Enums"]["account_status"]
          team_summary_mode?: Database["public"]["Enums"]["team_summary_mode"]
          text_size?: string
          theme_preference?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
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
          status?: Database["public"]["Enums"]["account_status"]
          team_summary_mode?: Database["public"]["Enums"]["team_summary_mode"]
          text_size?: string
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
          created_at: string
          created_task_id: string | null
          due_at: string | null
          due_is_date_only: boolean
          followup_answer: string | null
          followup_question: string | null
          id: string
          recommendation_reason: string
          recommended_destination: Database["public"]["Enums"]["capture_destination"]
          resolved_at: string | null
          status: Database["public"]["Enums"]["capture_status"]
          timing_choice: string
          title: string
          urgency_question_answer: boolean | null
          urgency_question_asked: boolean
        }
        Insert: {
          captured_by: string
          chosen_destination?:
            | Database["public"]["Enums"]["capture_destination"]
            | null
          created_at?: string
          created_task_id?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          followup_answer?: string | null
          followup_question?: string | null
          id?: string
          recommendation_reason: string
          recommended_destination: Database["public"]["Enums"]["capture_destination"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["capture_status"]
          timing_choice: string
          title: string
          urgency_question_answer?: boolean | null
          urgency_question_asked?: boolean
        }
        Update: {
          captured_by?: string
          chosen_destination?:
            | Database["public"]["Enums"]["capture_destination"]
            | null
          created_at?: string
          created_task_id?: string | null
          due_at?: string | null
          due_is_date_only?: boolean
          followup_answer?: string | null
          followup_question?: string | null
          id?: string
          recommendation_reason?: string
          recommended_destination?: Database["public"]["Enums"]["capture_destination"]
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["capture_status"]
          timing_choice?: string
          title?: string
          urgency_question_answer?: boolean | null
          urgency_question_asked?: boolean
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
          payload: Json
          proposed_by: string
          rationale: string | null
          status: Database["public"]["Enums"]["proposal_status"]
          title: string
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
          payload?: Json
          proposed_by: string
          rationale?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          title: string
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
          payload?: Json
          proposed_by?: string
          rationale?: string | null
          status?: Database["public"]["Enums"]["proposal_status"]
          title?: string
        }
        Relationships: [
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
      plan_events: {
        Row: {
          due_is_date_only: boolean | null
          event_kind: string | null
          occurs_at: string | null
          primary_owner_id: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          task_id: string | null
          title: string | null
          work_class: Database["public"]["Enums"]["work_class"] | null
        }
        Relationships: []
      }
      task_overview: {
        Row: {
          activation_reason_code:
            | Database["public"]["Enums"]["activation_reason"]
            | null
          activation_reason_note: string | null
          attachment_count: number | null
          cancelled_at: string | null
          checklist_completed: number | null
          checklist_ready: number | null
          checklist_total: number | null
          collaborator_count: number | null
          completed_at: string | null
          created_at: string | null
          description: string | null
          due_at: string | null
          due_is_date_only: boolean | null
          focus_bucket: Database["public"]["Enums"]["focus_bucket"] | null
          id: string | null
          is_mandatory: boolean | null
          is_overdue: boolean | null
          is_stale: boolean | null
          last_meaningful_update_at: string | null
          missing_evidence_count: number | null
          next_action: string | null
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
          routine_template_id: string | null
          state_entered_at: string | null
          status: Database["public"]["Enums"]["task_status"] | null
          title: string | null
          urgency: Database["public"]["Enums"]["urgency_level"] | null
          version: number | null
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
        Insert: {
          available_work_count?: never
          decisions_pending?: never
          department_id?: string | null
          employee_id?: string | null
          full_name?: string | null
          open_barrier_count?: never
          operational_created_this_week?: never
          overdue_count?: never
          quick_actions_created_this_week?: never
          reporting_manager_id?: string | null
          routines_completed_this_week?: never
          routines_overdue?: never
          routines_this_week?: never
          stale_count?: never
          user_id?: string | null
        }
        Update: {
          available_work_count?: never
          decisions_pending?: never
          department_id?: string | null
          employee_id?: string | null
          full_name?: string | null
          open_barrier_count?: never
          operational_created_this_week?: never
          overdue_count?: never
          quick_actions_created_this_week?: never
          reporting_manager_id?: string | null
          routines_completed_this_week?: never
          routines_overdue?: never
          routines_this_week?: never
          stale_count?: never
          user_id?: string | null
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
    }
    Functions: {
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
      cancel_task: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_reason: string
          p_task_id: string
        }
        Returns: Json
      }
      complete_checklist_item: {
        Args: {
          p_completion_note?: string
          p_idempotency_key?: string
          p_item_id: string
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
      delete_user_permanently: {
        Args: { p_employee_id_confirmation: string; p_user_id: string }
        Returns: Json
      }
      generate_routine_occurrences: {
        Args: { p_through?: string }
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
      post_task_update: {
        Args: {
          p_attachments?: Json
          p_body?: string
          p_checklist_item_id?: string
          p_idempotency_key?: string
          p_is_evidence_only?: boolean
          p_mention_ids?: string[]
          p_next_action?: string
          p_task_id: string
        }
        Returns: Json
      }
      post_task_update_v34_internal: {
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
      raise_barrier: {
        Args: {
          p_add_to_meeting_queue?: boolean
          p_description: string
          p_idempotency_key?: string
          p_impact: Database["public"]["Enums"]["barrier_impact"]
          p_support_needed: string
          p_task_id: string
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
      record_routine_finding: {
        Args: {
          p_description: string
          p_follow_up_owner_id?: string
          p_occurrence_task_id: string
          p_severity: Database["public"]["Enums"]["finding_severity"]
        }
        Returns: Json
      }
      reopen_checklist_item: {
        Args: { p_item_id: string; p_reason?: string }
        Returns: Json
      }
      resolve_barrier: {
        Args: { p_barrier_id: string; p_resolution_note: string }
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
      set_task_next_action: {
        Args: {
          p_expected_version: number
          p_idempotency_key?: string
          p_mark_done?: boolean
          p_next_action?: string
          p_task_id: string
        }
        Returns: Json
      }
      set_user_visibility: {
        Args: {
          p_mode: Database["public"]["Enums"]["visibility_mode"]
          p_reason?: string
          p_subject_ids?: string[]
          p_viewer_id: string
        }
        Returns: Json
      }
      undo_event: {
        Args: { p_event_id: string; p_idempotency_key?: string }
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
        | "next_action_changed"
        | "next_action_completed"
      barrier_impact:
        | "may_delay"
        | "cannot_continue"
        | "safety_or_compliance_risk"
        | "management_decision_required"
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
      email_delivery_status: "queued" | "sent" | "failed"
      email_summary_type: "personal" | "manager_team"
      evidence_rule: "not_required" | "optional" | "required"
      finding_severity: "minor" | "significant" | "immediate_risk"
      focus_bucket: "major" | "operational" | "self_development"
      focus_target_scope: "system" | "department" | "user"
      meeting_item_source:
        | "barrier"
        | "overdue_high_impact"
        | "stale_work"
        | "over_target_focus"
        | "missed_selection_deadline"
        | "completion_review_overdue"
        | "unresolved_dependency"
      meeting_item_status: "open" | "decided" | "dismissed"
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
      personal_summary_mode: "off" | "focused" | "standard"
      proposal_status: "pending" | "approved" | "rejected"
      recurrence_frequency: "daily" | "weekly" | "monthly"
      relation_type: "before" | "after" | "related"
      review_decision: "accepted" | "changes_requested"
      review_status: "pending" | "decided" | "not_required"
      task_status: "backlog" | "active" | "paused" | "completed" | "cancelled"
      team_summary_mode: "off" | "leadership" | "detailed"
      urgency_level: "normal" | "high" | "critical"
      visibility_mode: "specific_only" | "direct_reports_plus" | "none"
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
        "next_action_changed",
        "next_action_completed",
      ],
      barrier_impact: [
        "may_delay",
        "cannot_continue",
        "safety_or_compliance_risk",
        "management_decision_required",
      ],
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
      email_delivery_status: ["queued", "sent", "failed"],
      email_summary_type: ["personal", "manager_team"],
      evidence_rule: ["not_required", "optional", "required"],
      finding_severity: ["minor", "significant", "immediate_risk"],
      focus_bucket: ["major", "operational", "self_development"],
      focus_target_scope: ["system", "department", "user"],
      meeting_item_source: [
        "barrier",
        "overdue_high_impact",
        "stale_work",
        "over_target_focus",
        "missed_selection_deadline",
        "completion_review_overdue",
        "unresolved_dependency",
      ],
      meeting_item_status: ["open", "decided", "dismissed"],
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
      ],
      personal_summary_mode: ["off", "focused", "standard"],
      proposal_status: ["pending", "approved", "rejected"],
      recurrence_frequency: ["daily", "weekly", "monthly"],
      relation_type: ["before", "after", "related"],
      review_decision: ["accepted", "changes_requested"],
      review_status: ["pending", "decided", "not_required"],
      task_status: ["backlog", "active", "paused", "completed", "cancelled"],
      team_summary_mode: ["off", "leadership", "detailed"],
      urgency_level: ["normal", "high", "critical"],
      visibility_mode: ["specific_only", "direct_reports_plus", "none"],
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
    },
  },
} as const

