# Conversation Center

This context defines the domain language for the lightweight Conversation Center in V1.4. It keeps conversation identity, service topics, timeline entries, and the authoritative ticket lifecycle distinct.

## Conversation identity

**Channel Account**:
The provider account through which a conversation is held, such as a WeCom bot identity.
_Avoid_: Bot implementation, application instance

**Chat Type**:
The kind of provider conversation, either a direct conversation with one participant or a group conversation.
_Avoid_: Message type, channel mode

**External Thread Key**:
The provider-issued identity of a long-lived conversation within a Channel Account and Chat Type.
_Avoid_: Message ID, Session ID

**Conversation Thread**:
A long-lived communication window identified by its provider, Channel Account, Chat Type, and External Thread Key.
_Avoid_: Conversation Session, Ticket, chat message

**Participant**:
The person whose service topic is being handled within a Conversation Thread, including one member of a group conversation.
_Avoid_: Chat, reporter account

## Service conversation

**Conversation Session**:
A continuous service topic inside a Conversation Thread, bounded by a topic change or the end of the topic.
_Avoid_: Thread, Ticket, chat window

**Session Scope**:
The combination of a Conversation Thread, a Participant, and an optional Service Intake that keeps one service topic’s context together.
_Avoid_: Ticket scope, global conversation

**Service Intake**:
A recorded request for service that captures one requester’s need and may be associated with the authoritative Unified Ticket.
_Avoid_: Conversation, Ticket event, Incident

**Control Mode**:
The declared human/AI operating mode of a Conversation Session: HUMAN, COPILOT, or AUTO.
_Avoid_: Session status, assignment state

**Human**:
The mode in which a person retains control of externally visible replies; it is the default Conversation Session mode.
_Avoid_: Agent, operator identity

**Copilot**:
The mode in which AI may suggest a draft while a person retains reply control.
_Avoid_: Automatic reply, delegated agent

**Auto**:
The mode name reserved for an approved controlled-automation policy; it is not permission for unrestricted automatic replies.
_Avoid_: AI enabled, autonomous operation

## Timeline and lifecycle

**Conversation Item**:
A single visible or internal entry associated with a Conversation Session, such as a user message, reply, note, or domain event.
_Avoid_: Channel Message, Ticket Event, database record

**Generation Version**:
The monotonic generation marker for the current Conversation Session context.
_Avoid_: Model version, Session status

**Row Version**:
The revision marker for a Conversation Session representation.
_Avoid_: Generation Version, Ticket version

**Unified Ticket**:
The authoritative record of service handling lifecycle, separate from conversation identity and communication history.
_Avoid_: Conversation Session, Service Intake, second ticket
