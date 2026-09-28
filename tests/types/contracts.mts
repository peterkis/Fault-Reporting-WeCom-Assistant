// Every contract module is consumed by the real NodeNext program. These are
// declaration checks, not a claim that legacy JavaScript implementations are typed.
import type * as C0 from '../../contracts/communication_contracts.js';
import type * as C1 from '../../contracts/conversation_contracts.js';
import type * as C2 from '../../contracts/conversation_control_contracts.js';
import type * as C3 from '../../contracts/conversation_projection_contracts.js';
import type * as C4 from '../../contracts/conversation_realtime_contracts.js';
import type * as C5 from '../../contracts/p2_007_decision_contracts.js';
import type * as C6 from '../../contracts/p2_012_contracts.js';
import type * as C7 from '../../contracts/p2_015_contracts.js';
import type * as C8 from '../../contracts/p2_016_contracts.js';
import type * as C9 from '../../contracts/time_contracts.js';
import type * as C10 from '../../contracts/workbench_contracts.js';
import type * as C11 from '../../contracts/yixiaoxiu_contracts.js';
import type * as C12 from '../../contracts/yxx_self_service_contracts.js';

export type ContractSurface = [typeof C0, typeof C1, typeof C2, typeof C3, typeof C4, typeof C5, typeof C6, typeof C7, typeof C8, typeof C9, typeof C10, typeof C11, typeof C12];
import type { LocalDateTime, PhysicalEpochMs } from '../../contracts/time_contracts.js';
import type { YxxRequestInput } from '../../contracts/yxx_self_service_contracts.js';
declare const date: LocalDateTime;
declare const epoch: PhysicalEpochMs;
const stringDate: string = date;
const stringEpoch: string = epoch;
// @ts-expect-error -- milliseconds and local datetime are distinct branded strings
const wrongClock: PhysicalEpochMs = date;
// @ts-expect-error -- an unvalidated string cannot become a branded local datetime
const unvalidatedDate: LocalDateTime = '2026-09-28 12:00:00';
const request: YxxRequestInput = { schema_version: 1, client_command_id: 'synthetic', description: 'synthetic fault', location: { text: null, unknown: true }, service_code: null, impact_scope: 'SELF', reported_department_text: null, extension: null };
// @ts-expect-error -- unknown impact scope must be rejected at the contract boundary
const wrongScope: YxxRequestInput['impact_scope'] = 'ALL_HOSPITAL';
void [stringDate, stringEpoch, wrongClock, unvalidatedDate, request, wrongScope];
