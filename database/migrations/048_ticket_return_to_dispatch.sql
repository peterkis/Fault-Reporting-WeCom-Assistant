BEGIN;

-- Extend the existing Core event vocabulary; never create a second owner or round fact.
ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT ticket_event_type_check;
ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT ticket_event_type_check CHECK (event_type IN (
    'ticket.created','ticket.queued','ticket.accepted','ticket.started','ticket.waiting_requester',
    'ticket.waiting_vendor','ticket.resumed','ticket.resolved','ticket.closed','ticket.reopened',
    'ticket.cancelled','ticket.duplicate_linked','ticket.unlinked','ticket.note_added',
    'ticket.information_added','ticket.auto_close_reminder','ticket.assignment_transferred','ticket.unassigned','ticket.returned_to_dispatch'
));
ALTER TABLE pilot_ticket.ticket_event DROP CONSTRAINT p2016_assignment_metadata_check;
ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT p2016_assignment_metadata_check CHECK (
    (event_type NOT IN ('ticket.unassigned','ticket.returned_to_dispatch') AND (assignment_metadata IS NULL OR (
        event_type='ticket.assignment_transferred' AND jsonb_typeof(assignment_metadata)='object'
        AND assignment_metadata - ARRAY['old_assignee_id','new_assignee_id','old_team_id','new_team_id']::text[]='{}'::jsonb
    ))) OR (
        event_type IN ('ticket.unassigned','ticket.returned_to_dispatch') AND assignment_metadata IS NOT NULL
        AND jsonb_typeof(assignment_metadata)='object'
        AND assignment_metadata ?& ARRAY['old_assignee_id','new_assignee_id','old_team_id','new_team_id']::text[]
        AND assignment_metadata - ARRAY['old_assignee_id','new_assignee_id','old_team_id','new_team_id']::text[]='{}'::jsonb
        AND jsonb_typeof(assignment_metadata->'old_assignee_id')='string'
        AND assignment_metadata->>'old_assignee_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        AND assignment_metadata->'new_assignee_id'='null'::jsonb
        AND jsonb_typeof(assignment_metadata->'old_team_id')='string'
        AND assignment_metadata->>'old_team_id' ~ '^[A-Z][A-Z0-9_]{0,63}$'
        AND assignment_metadata->'old_team_id'=assignment_metadata->'new_team_id'
        AND old_status IS NOT NULL AND new_status='QUEUED'
        AND ((event_type='ticket.unassigned' AND old_status IN ('QUEUED','ACCEPTED'))
          OR (event_type='ticket.returned_to_dispatch' AND old_status IN ('IN_PROGRESS','WAITING_REQUESTER','WAITING_VENDOR')))
        AND operator_type='PILOT_USER' AND operator_id IS NOT NULL
        AND internal_note IS NOT NULL AND char_length(internal_note) BETWEEN 1 AND 2000 AND btrim(internal_note)<>''
        AND external_note IS NULL AND reason_code IS NOT NULL
    )
);

COMMIT;
