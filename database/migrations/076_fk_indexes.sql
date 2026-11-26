BEGIN;

-- Card 42C-1: Foreign key supporting indexes (74 B-tree indexes covering 75 missing FKs).
-- Excluded:
--   * Low-volume / non-hot-JOIN tables (29 FKs across incident.*, communication.incident_notification_binding, workbench.source_group_name*).
--   * intake.deterministic_decision (channel_leg_id) is subsumed by deterministic_decision_leg_intake_sub_fk_idx (channel_leg_id, service_intake_id, primary_web_submission_id).
--   * Card 42A's ticket_terminal_idx / terminal_at is untouched.

CREATE INDEX communication_message_reply_item_fk_idx
    ON communication.message (reply_to_conversation_item_id);

CREATE INDEX conversation_assignment_assigned_principal_fk_idx
    ON conversation.assignment (assigned_principal_id);
CREATE INDEX conversation_assignment_assigned_by_fk_idx
    ON conversation.assignment (assigned_by_principal_id);

CREATE INDEX conversation_control_event_actor_fk_idx
    ON conversation.control_event (actor_principal_id);
CREATE INDEX conversation_control_event_target_fk_idx
    ON conversation.control_event (target_principal_id);
CREATE INDEX conversation_control_event_handoff_fk_idx
    ON conversation.control_event (handoff_id);

CREATE INDEX conversation_handoff_requested_by_fk_idx
    ON conversation.handoff (requested_by_principal_id);
CREATE INDEX conversation_handoff_assigned_principal_fk_idx
    ON conversation.handoff (assigned_principal_id);

CREATE INDEX conversation_item_source_binding_item_session_fk_idx
    ON conversation.item_source_binding (item_id, session_id);

CREATE INDEX conversation_session_service_intake_fk_idx
    ON conversation.session (service_intake_id);

CREATE INDEX incident_event_actor_principal_fk_idx
    ON incident.incident_event (actor_principal_id);

CREATE INDEX incident_report_ticket_fk_idx
    ON incident.incident_report (ticket_id);

CREATE INDEX channel_leg_conversation_thread_fk_idx
    ON intake.channel_leg (conversation_thread_id);
CREATE INDEX channel_leg_conversation_session_fk_idx
    ON intake.channel_leg (conversation_session_id);
CREATE INDEX channel_leg_origin_channel_message_fk_idx
    ON intake.channel_leg (origin_channel_message_id);
CREATE INDEX channel_leg_web_submission_intake_fk_idx
    ON intake.channel_leg (web_submission_id, source_intake_id);

CREATE INDEX contact_journey_origin_session_fk_idx
    ON intake.contact_journey (origin_session_id);
CREATE INDEX contact_journey_current_session_fk_idx
    ON intake.contact_journey (current_session_id);
CREATE INDEX contact_journey_linked_ticket_fk_idx
    ON intake.contact_journey (linked_ticket_id);

CREATE INDEX continuation_ref_journey_fk_idx
    ON intake.continuation_ref (journey_id);
CREATE INDEX continuation_ref_origin_leg_fk_idx
    ON intake.continuation_ref (origin_leg_id);
CREATE INDEX continuation_ref_target_leg_fk_idx
    ON intake.continuation_ref (target_leg_id);

CREATE INDEX deterministic_decision_leg_intake_sub_fk_idx
    ON intake.deterministic_decision (channel_leg_id, service_intake_id, primary_web_submission_id);
CREATE INDEX deterministic_decision_session_fk_idx
    ON intake.deterministic_decision (conversation_session_id);
CREATE INDEX deterministic_decision_linked_ticket_fk_idx
    ON intake.deterministic_decision (linked_ticket_id);
CREATE INDEX deterministic_decision_primary_web_sub_fk_idx
    ON intake.deterministic_decision (primary_web_submission_id);

CREATE INDEX manual_review_item_decision_fk_idx
    ON intake.manual_review_item (decision_id);
CREATE INDEX manual_review_item_service_intake_fk_idx
    ON intake.manual_review_item (service_intake_id);
CREATE INDEX manual_review_item_linked_ticket_fk_idx
    ON intake.manual_review_item (linked_ticket_id);
CREATE INDEX manual_review_item_resolved_by_fk_idx
    ON intake.manual_review_item (resolved_by_principal_id);
CREATE INDEX manual_review_item_resolution_decision_fk_idx
    ON intake.manual_review_item (resolution_decision_id);

CREATE INDEX service_intake_primary_web_sub_id_fk_idx
    ON intake.service_intake (primary_web_submission_id, id);
CREATE INDEX service_intake_manual_actor_fk_idx
    ON intake.service_intake (manual_actor_principal_id);

CREATE INDEX ticket_reporter_profile_source_intake_fk_idx
    ON intake.ticket_reporter_profile (source_intake_id);

CREATE INDEX web_media_upload_intake_fk_idx
    ON intake.web_media_upload (intake_id);
CREATE INDEX web_media_upload_request_ref_fk_idx
    ON intake.web_media_upload (request_ref);
CREATE INDEX web_media_upload_submission_intake_fk_idx
    ON intake.web_media_upload (submission_id, intake_id);

CREATE INDEX web_report_evaluation_ticket_fk_idx
    ON intake.web_report_evaluation (ticket_id);
CREATE INDEX web_report_evaluation_completion_event_fk_idx
    ON intake.web_report_evaluation (completion_event_id);
CREATE INDEX web_report_evaluation_source_intake_fk_idx
    ON intake.web_report_evaluation (source_intake_id);

CREATE INDEX web_report_urge_cycle_fk_idx
    ON intake.web_report_urge (cycle_id);
CREATE INDEX web_report_urge_source_intake_fk_idx
    ON intake.web_report_urge (source_intake_id);

CREATE INDEX web_submission_command_receipt_fk_idx
    ON intake.web_submission (command_receipt_id);
CREATE INDEX web_submission_intake_reporter_fk_idx
    ON intake.web_submission (intake_id, canonical_reporter_binding);

CREATE INDEX card_action_task_ticket_fk_idx
    ON notification.card_action_task (ticket_id);

CREATE INDEX audit_event_actor_principal_fk_idx
    ON operations.audit_event (actor_principal_id);

CREATE INDEX closure_record_ticket_fk_idx
    ON pilot_ticket.closure_record (ticket_id);
CREATE INDEX closure_record_intake_fk_idx
    ON pilot_ticket.closure_record (intake_id);
CREATE INDEX closure_record_ticket_event_fk_idx
    ON pilot_ticket.closure_record (closure_ticket_event_id);
CREATE INDEX closure_record_intake_event_fk_idx
    ON pilot_ticket.closure_record (closure_intake_event_id);
CREATE INDEX closure_record_aborted_cycle_event_fk_idx
    ON pilot_ticket.closure_record (aborted_cycle_event_id);

CREATE INDEX closure_supplement_term_source_intake_fk_idx
    ON pilot_ticket.closure_supplement_termination (source_intake_id);

CREATE INDEX follow_up_schedule_ticket_version_fk_idx
    ON pilot_ticket.follow_up_schedule (ticket_id, schedule_version);
CREATE INDEX follow_up_schedule_ticket_event_fk_idx
    ON pilot_ticket.follow_up_schedule (ticket_id, scheduled_event_id);

CREATE INDEX follow_up_schedule_rev_ticket_event_fk_idx
    ON pilot_ticket.follow_up_schedule_revision (ticket_id, ticket_event_id);

CREATE INDEX personal_material_read_source_intake_fk_idx
    ON pilot_ticket.personal_material_read_position (source_intake_id);

CREATE INDEX staff_completion_commit_cycle_fk_idx
    ON pilot_ticket.staff_completion_notification_commitment (ticket_id, cycle_id, ticket_event_id, source_intake_id);

CREATE INDEX ticket_id_current_handling_cycle_fk_idx
    ON pilot_ticket.ticket (id, current_handling_cycle_id);

CREATE INDEX ticket_command_receipt_source_intake_fk_idx
    ON pilot_ticket.ticket_command_receipt (source_intake_id);
CREATE INDEX ticket_command_receipt_closure_intake_fk_idx
    ON pilot_ticket.ticket_command_receipt (closure_intake_id);

CREATE INDEX ticket_cycle_reopen_completed_cycle_fk_idx
    ON pilot_ticket.ticket_cycle_reopen (ticket_id, completed_cycle_id, completion_event_id, source_intake_id);
CREATE INDEX ticket_cycle_reopen_reopen_event_fk_idx
    ON pilot_ticket.ticket_cycle_reopen (ticket_id, reopen_event_id);
CREATE INDEX ticket_cycle_reopen_new_cycle_event_fk_idx
    ON pilot_ticket.ticket_cycle_reopen (ticket_id, new_cycle_id, reopen_event_id);

CREATE INDEX ticket_handling_cycle_source_intake_fk_idx
    ON pilot_ticket.ticket_handling_cycle (source_intake_id);
CREATE INDEX ticket_handling_cycle_first_principal_fk_idx
    ON pilot_ticket.ticket_handling_cycle (first_responsibility_principal_id);
CREATE INDEX ticket_handling_cycle_first_team_fk_idx
    ON pilot_ticket.ticket_handling_cycle (first_responsibility_team_id);
CREATE INDEX ticket_handling_cycle_first_event_fk_idx
    ON pilot_ticket.ticket_handling_cycle (ticket_id, first_responsibility_event_id);
CREATE INDEX ticket_handling_cycle_start_event_fk_idx
    ON pilot_ticket.ticket_handling_cycle (ticket_id, cycle_start_event_id);

CREATE INDEX ticket_handling_cycle_event_ticket_event_fk_idx
    ON pilot_ticket.ticket_handling_cycle_event (ticket_id, ticket_event_id);

CREATE INDEX ticket_public_progress_ticket_event_fk_idx
    ON pilot_ticket.ticket_public_progress (ticket_event_id);

CREATE INDEX workbench_item_follow_source_intake_fk_idx
    ON pilot_ticket.workbench_item_follow (source_intake_id);

CREATE INDEX workbench_supp_disp_source_intake_fk_idx
    ON pilot_ticket.workbench_supplement_disposition (source_intake_id);
CREATE INDEX workbench_supp_disp_actor_fk_idx
    ON pilot_ticket.workbench_supplement_disposition (actor_principal_id);

CREATE INDEX workbench_supp_reply_source_intake_fk_idx
    ON pilot_ticket.workbench_supplement_reply_binding (source_intake_id);

COMMIT;
