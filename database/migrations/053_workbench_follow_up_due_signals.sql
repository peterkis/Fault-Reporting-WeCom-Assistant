BEGIN;

-- One durable publication marker per original schedule revision; realtime retention is independent.
CREATE TABLE pilot_ticket.follow_up_due_signal (
    ticket_id UUID NOT NULL,
    schedule_version BIGINT NOT NULL,
    published_at TIMESTAMP(0) WITHOUT TIME ZONE NOT NULL,
    CONSTRAINT follow_up_due_signal_pkey PRIMARY KEY(ticket_id,schedule_version),
    CONSTRAINT follow_up_due_signal_revision_fk FOREIGN KEY(ticket_id,schedule_version)
        REFERENCES pilot_ticket.follow_up_schedule_revision(ticket_id,schedule_version),
    CONSTRAINT follow_up_due_signal_positive_version CHECK (schedule_version>=1)
);

COMMIT;
