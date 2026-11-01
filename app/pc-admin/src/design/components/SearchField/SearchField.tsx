import {Input} from '@heroui/react';
import {Search,X} from 'lucide-react';
import type {ComponentProps} from 'react';
import {Button} from '../Button/Button';
import './search-field.css';

type Props=ComponentProps<typeof Input> & {onClear?:()=>void};
export function SearchField({className='',onClear,...props}:Props){
  return <div className="ds-search-field"><Search aria-hidden="true"/><Input {...props} className={className}/>{props.value&&onClear?<Button tone="ghost" size="sm" isIconOnly aria-label="清除搜索内容" isDisabled={Boolean(props.disabled)} onPress={onClear}><X/></Button>:null}</div>;
}
