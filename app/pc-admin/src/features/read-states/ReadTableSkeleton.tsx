import {DataTable} from '../../design/components/DataTable/DataTable';
import {LoadingStatus,Skeleton} from '../../design/components/Skeleton/Skeleton';

/** Uses each page's real header labels and column classes, not the ticket table's columns. */
export function ReadTableSkeleton({label,columns,slow,onRetry,className='work-table',rowHeaderIndex=0}:{className?:string;rowHeaderIndex?:number;label:string;columns:readonly {title:string;className?:string}[];slow:boolean;onRetry?:()=>void}){
  return <LoadingStatus label={label} slow={slow} {...(onRetry?{onRetry}:{})}><div className="table-wrap"><DataTable><DataTable.ScrollContainer><DataTable.Content aria-label={label} className={className}><DataTable.Header>{columns.map((column,index)=><DataTable.Column key={column.title} isRowHeader={index===rowHeaderIndex} {...(column.className?{className:column.className}:{})}>{column.title}</DataTable.Column>)}</DataTable.Header><DataTable.Body>{[0,1,2,3,4].map(row=><DataTable.Row id={'loading-'+row} key={row}>{columns.map(column=><DataTable.Cell key={column.title}><Skeleton h="var(--lh-sm)"/></DataTable.Cell>)}</DataTable.Row>)}</DataTable.Body></DataTable.Content></DataTable.ScrollContainer></DataTable></div></LoadingStatus>;
}
