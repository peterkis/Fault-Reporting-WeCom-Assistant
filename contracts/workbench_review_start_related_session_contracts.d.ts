/** Current exact relation and READ proof for restoring this purpose; never grants a command. */
export interface ReviewStartRelatedSession {
  readonly review_id:string;
  readonly ticket_id:string;
  readonly session_id:string;
}
