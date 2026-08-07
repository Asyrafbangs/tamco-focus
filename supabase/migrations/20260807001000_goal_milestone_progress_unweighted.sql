-- ============================================================================
-- Goal progress: milestones carry completion only, not weight
--
-- Product Owner decision: weighting belongs to the GOAL, not to its milestones.
-- A milestone records how complete it is; a goal records how much it counts
-- towards the formal set.
--
-- `goal_overview.derived_progress` therefore becomes the plain average of
-- milestone completion instead of a milestone-weighted total. Goal-level
-- weighting (`weight_percent` on the goal, and the formal Active weight
-- rollup) is unchanged.
--
-- `goal_milestones.weight_percent` is retained rather than dropped: existing
-- rows carry values and removing the column would rewrite applied history for
-- no functional gain. It is simply no longer read by any progress calculation,
-- and no longer offered during goal setup.
-- ============================================================================

create or replace view public.goal_overview
with (security_invoker = true)
as
SELECT g.id,
    g.owner_id,
    owner.full_name AS owner_name,
    owner.employee_id AS owner_employee_id,
    owner.reporting_manager_id,
    g.manager_id,
    manager.full_name AS manager_name,
    g.title,
    g.category,
    g.status,
    g.health,
    g.reported_progress,
    COALESCE(progress.derived_progress::integer, 0)::smallint AS derived_progress,
    g.target_date,
    g.weight_percent,
    g.checkin_due_at,
    g.update_requested_at,
    g.last_meaningful_update_at,
    g.active_version_id,
    g.pending_version_id,
    g.agreed_at,
    g.completed_at,
    g.closed_at,
    g.version,
    g.created_at,
    current_milestone.id AS current_milestone_id,
    current_milestone.title AS current_milestone_title,
    current_milestone.progress_percent AS current_milestone_progress,
    next_milestone.title AS next_milestone_title,
    COALESCE(support.open_count, 0) AS open_support_count,
    g.status = 'active'::goal_status AND g.checkin_due_at IS NOT NULL AND g.checkin_due_at <= now() AS is_checkin_due,
    g.status = 'active'::goal_status AND g.update_requested_at IS NOT NULL AS is_update_requested,
    g.status = 'active'::goal_status AND g.target_date >= CURRENT_DATE AND g.target_date <= (CURRENT_DATE + 30) AND g.reported_progress < 100 AS is_target_approaching,
    COALESCE(recent_completion.has_recent_completion, false) AS has_recent_milestone_completion,
    (g.health = ANY (ARRAY['need_attention'::goal_health, 'support_requested'::goal_health])) OR COALESCE(support.open_count, 0) > 0 OR g.status = 'active'::goal_status AND g.checkin_due_at IS NOT NULL AND g.checkin_due_at <= now() OR g.status = 'active'::goal_status AND g.update_requested_at IS NOT NULL OR g.status = 'active'::goal_status AND g.target_date >= CURRENT_DATE AND g.target_date <= (CURRENT_DATE + 30) AND g.reported_progress < 100 OR COALESCE(recent_completion.has_recent_completion, false) AS needs_attention,
        CASE
            WHEN COALESCE(support.open_count, 0) > 0 OR g.health = 'support_requested'::goal_health THEN 'Support requested'::text
            WHEN g.update_requested_at IS NOT NULL THEN 'Manager requested an update'::text
            WHEN g.checkin_due_at IS NOT NULL AND g.checkin_due_at <= now() THEN 'Progress check-in due'::text
            WHEN g.health = 'need_attention'::goal_health THEN 'Needs attention'::text
            WHEN g.target_date >= CURRENT_DATE AND g.target_date <= (CURRENT_DATE + 30) AND g.reported_progress < 100 THEN 'Target date approaching'::text
            WHEN COALESCE(recent_completion.has_recent_completion, false) THEN 'Milestone completed'::text
            ELSE NULL::text
        END AS attention_reason,
    version_data.expected_result,
    version_data.success_measure,
    version_data.employee_approach,
    version_data.support_agreed,
    version_data.dependencies,
    version_data.baseline,
    version_data.purpose,
    version_data.version_number AS active_version_number
   FROM goals g
     JOIN user_profiles owner ON owner.id = g.owner_id
     LEFT JOIN user_profiles manager ON manager.id = g.manager_id
     LEFT JOIN goal_versions version_data ON version_data.id = COALESCE(g.active_version_id, g.pending_version_id)
     LEFT JOIN LATERAL ( SELECT round(avg(m.progress_percent)::numeric)::smallint AS derived_progress
           FROM goal_milestones m
          WHERE m.goal_version_id = g.active_version_id) progress ON true
     LEFT JOIN LATERAL ( SELECT m.id,
            m.title,
            m.progress_percent,
            m."position"
           FROM goal_milestones m
          WHERE m.goal_version_id = COALESCE(g.active_version_id, g.pending_version_id) AND m.progress_percent < 100
          ORDER BY m."position"
         LIMIT 1) current_milestone ON true
     LEFT JOIN LATERAL ( SELECT m.title
           FROM goal_milestones m
          WHERE m.goal_version_id = COALESCE(g.active_version_id, g.pending_version_id) AND m."position" > COALESCE(current_milestone."position"::integer, 0)
          ORDER BY m."position"
         LIMIT 1) next_milestone ON true
     LEFT JOIN LATERAL ( SELECT count(*)::integer AS open_count
           FROM goal_support_requests sr
          WHERE sr.goal_id = g.id AND sr.status <> 'resolved'::text) support ON true
     LEFT JOIN LATERAL ( SELECT (EXISTS ( SELECT 1
                   FROM goal_milestone_updates mu
                  WHERE mu.goal_id = g.id AND mu.marked_complete AND mu.created_at >= (now() - '7 days'::interval))) AS has_recent_completion) recent_completion ON true;
