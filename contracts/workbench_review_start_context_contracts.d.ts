/** Current, bounded choices for the independent explicit review-and-start purpose. */
export interface ReviewStartContext {
  readonly review_id:string;
  readonly expected_ticket:{readonly ticket_id:string;readonly expected_version:number}|null;
  readonly resolver_team_id:string|null;
  readonly resolver_teams:readonly {readonly team_id:string;readonly display_name:string}[];
  readonly allowed:boolean;
}
