/** T42 presentation intent only. Never a Ticket/Review command or authority proof. */
export type WorkbenchBoardColumn = 'pending' | 'active' | 'closed';
export interface WorkbenchBoardActionIntent {
  readonly kind: 'ticket' | 'review' | 'intake';
  readonly id: string;
  readonly source_column: WorkbenchBoardColumn;
  readonly target_column: WorkbenchBoardColumn;
}
export type WorkbenchBoardAction = 'SELF_HANDLE' | 'REVIEW_RESOLVE_AND_START' | 'STAFF_COMPLETE' | 'STAFF_REOPEN';
export type WorkbenchBoardActionResolution =
  | {readonly state: 'OPEN_EXISTING_FORM'; readonly intent: WorkbenchBoardActionIntent; readonly action: WorkbenchBoardAction}
  | {readonly state: 'NO_CHANGE'; readonly intent: WorkbenchBoardActionIntent}
  | {readonly state: 'UNAVAILABLE'; readonly intent: WorkbenchBoardActionIntent; readonly reason: 'INVALID_TRANSITION' | 'NO_CURRENT_ACTION'};
/** Proposed bootstrap fragment; absent is false. SOURCE baseline does not mount it. */
export interface WorkbenchBoardActionCapability {
  readonly board_actions_enabled: boolean;
}
