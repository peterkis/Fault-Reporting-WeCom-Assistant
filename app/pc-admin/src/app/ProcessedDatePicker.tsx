import {Button,DateField,DateRangePicker,Label,RangeCalendar} from '@heroui/react';
import {parseDate} from '@internationalized/date';
import {useState} from 'react';
import type {BoardCompletionRange} from '../api/client';

const minimum=parseDate('0001-01-01'),maximum=parseDate('9999-12-30');
function selectedDates(range:BoardCompletionRange,dates:{from:string;to:string}|undefined,now:number){
  if(range==='recent')return {start:parseDate(new Date(now+8*3_600_000-86_400_000).toISOString().slice(0,10)),end:parseDate(new Date(now+8*3_600_000).toISOString().slice(0,10))};
  if(range!=='custom'||!dates)return null;
  try{const start=parseDate(dates.from),end=parseDate(dates.to);return start.compare(minimum)>=0&&end.compare(maximum)<=0&&start.compare(end)<=0?{start,end}:null;}catch{return null;}
}

export function ProcessedDatePicker({range,dates,now,blocked,onApply}:{range:BoardCompletionRange;dates?:{from:string;to:string}|undefined;now:number;blocked:boolean;onApply:(range:BoardCompletionRange,dates?:{from:string;to:string})=>void}){
  const [value,setValue]=useState(()=>selectedDates(range,dates,now));
  const valid=Boolean(value&&value.start.compare(minimum)>=0&&value.end.compare(maximum)<=0&&value.start.compare(value.end)<=0);
  return <div className="processed-date-controls">
    <DateRangePicker aria-label="已处理日期" className="processed-date-picker" value={value} minValue={minimum} maxValue={maximum} validationBehavior="aria" isDisabled={blocked} onChange={setValue}>{({isInvalid})=><>
      <Label>已处理日期</Label><DateField.Group><DateField.Input slot="start">{segment=><DateField.Segment segment={segment}/>}</DateField.Input><DateRangePicker.RangeSeparator/><DateField.Input slot="end">{segment=><DateField.Segment segment={segment}/>}</DateField.Input><DateField.Suffix><DateRangePicker.Trigger aria-label="选择已处理日期"><DateRangePicker.TriggerIndicator/></DateRangePicker.Trigger></DateField.Suffix></DateField.Group>
      <DateRangePicker.Popover className="processed-date-popover"><RangeCalendar aria-label="选择已处理日期范围">
        <RangeCalendar.Header><RangeCalendar.YearPickerTrigger><RangeCalendar.YearPickerTriggerHeading/><RangeCalendar.YearPickerTriggerIndicator/></RangeCalendar.YearPickerTrigger><RangeCalendar.NavButton slot="previous"/><RangeCalendar.NavButton slot="next"/></RangeCalendar.Header>
        <RangeCalendar.Grid><RangeCalendar.GridHeader>{day=><RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}</RangeCalendar.GridHeader><RangeCalendar.GridBody>{date=><RangeCalendar.Cell date={date}/>}</RangeCalendar.GridBody></RangeCalendar.Grid>
        <RangeCalendar.YearPickerGrid><RangeCalendar.YearPickerGridBody>{({year})=><RangeCalendar.YearPickerCell year={year}/>}</RangeCalendar.YearPickerGridBody></RangeCalendar.YearPickerGrid>
      </RangeCalendar></DateRangePicker.Popover>
      <Button slot={null} variant="secondary" size="sm" aria-label="应用已处理日期" isDisabled={blocked||isInvalid||!valid} onPress={()=>{if(!blocked&&!isInvalid&&valid&&value)onApply('custom',{from:value.start.toString(),to:value.end.toString()});}}>应用</Button>
    </>}</DateRangePicker>
    {range==='cancelled'?<span className="processed-date-note">仅显示已取消事项</span>:null}
    {range!=='all'||value?<Button variant="ghost" size="sm" aria-label="清除已处理日期和取消筛选" isDisabled={blocked} onPress={()=>{setValue(null);onApply('all');}}>清除</Button>:<span className="processed-date-note">全部日期</span>}
  </div>;
}
