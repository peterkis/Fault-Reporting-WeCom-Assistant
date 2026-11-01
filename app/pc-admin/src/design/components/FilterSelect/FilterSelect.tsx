import type {ComponentProps} from 'react';
import {WorkbenchSelect} from '../../../app/WorkbenchSelect';
import './filter-select.css';

export function FilterSelect({className='',...props}:ComponentProps<typeof WorkbenchSelect>){
  return <WorkbenchSelect {...props} inlinePrefix className={'ds-filter-select '+className}/>;
}
