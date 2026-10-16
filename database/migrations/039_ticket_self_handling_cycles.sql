BEGIN;

-- The owner remains exclusively on ticket. These rows are immutable handling-history facts.
ALTER TABLE pilot_ticket.ticket_event ADD CONSTRAINT ticket_event_ticket_identity UNIQUE(ticket_id,event_id);
CREATE TABLE pilot_ticket.ticket_handling_cycle (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    ticket_id UUID NOT NULL REFERENCES pilot_ticket.ticket(id),
    cycle_no INTEGER NOT NULL CHECK(cycle_no>0),
    source_intake_id UUID NOT NULL REFERENCES intake.service_intake(id),
    cycle_start_event_id UUID NOT NULL,
    first_responsibility_event_id UUID,
    first_responsibility_principal_id UUID REFERENCES pilot_ticket.pilot_principal(id),
    first_responsibility_team_id TEXT REFERENCES pilot_ticket.resolver_team(team_id),
    client_command_id UUID NOT NULL,
    created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT platform.local_now(),
    UNIQUE(ticket_id,cycle_no),
    UNIQUE(ticket_id,id),
    UNIQUE(first_responsibility_event_id),
    FOREIGN KEY(ticket_id,first_responsibility_event_id) REFERENCES pilot_ticket.ticket_event(ticket_id,event_id),
    FOREIGN KEY(ticket_id,cycle_start_event_id) REFERENCES pilot_ticket.ticket_event(ticket_id,event_id),
    CHECK((first_responsibility_event_id IS NULL AND first_responsibility_principal_id IS NULL AND first_responsibility_team_id IS NULL)
       OR (first_responsibility_event_id IS NOT NULL AND first_responsibility_principal_id IS NOT NULL AND first_responsibility_team_id IS NOT NULL))
);
ALTER TABLE pilot_ticket.ticket ADD COLUMN current_handling_cycle_id UUID;
ALTER TABLE pilot_ticket.ticket ADD CONSTRAINT ticket_current_handling_cycle
    FOREIGN KEY(id,current_handling_cycle_id) REFERENCES pilot_ticket.ticket_handling_cycle(ticket_id,id);
CREATE TABLE pilot_ticket.ticket_handling_cycle_event (
    ticket_id UUID NOT NULL,
    cycle_id UUID NOT NULL,
    ticket_event_id UUID NOT NULL,
    PRIMARY KEY(ticket_event_id),
    FOREIGN KEY(ticket_id,cycle_id) REFERENCES pilot_ticket.ticket_handling_cycle(ticket_id,id),
    FOREIGN KEY(ticket_id,ticket_event_id) REFERENCES pilot_ticket.ticket_event(ticket_id,event_id)
);

COMMIT;
