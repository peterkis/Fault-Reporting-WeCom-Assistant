/** T34 current closed contract; service/migration NOT_MOUNTED at initial freeze. */
export interface FollowItem {readonly kind:'ticket'|'review'|'intake';readonly id:string}
export interface WorkbenchFollowCommand {readonly client_command_id:string;readonly canonical_item:FollowItem;readonly expected_follow_version:string;readonly following:boolean}
export interface WorkbenchFollowAttention {readonly following:boolean;readonly follow_version:string;readonly related_reasons:readonly ('HANDLING'|'COMMUNICATION'|'FOLLOW')[]}
export interface WorkbenchFollowResult {readonly ok:true;readonly client_command_id:string;readonly requested_item:FollowItem;readonly canonical_item:FollowItem;readonly following:boolean;readonly follow_version:string;readonly replayed:boolean}
export type WorkbenchFollowReceipt=Readonly<{client_command_id:string;requested_item:FollowItem}>&(
 Readonly<{state:'UNKNOWN'}>|Readonly<{state:'COMMITTED';result:WorkbenchFollowResult}>|Readonly<{state:'FAILED';error:Readonly<{code:string;retryable:false}>}>);
