import type {ComponentProps} from 'react';
import {Table} from '@heroui/react';
import './data-table.css';

function Root({className='',...props}:Omit<ComponentProps<typeof Table>,'variant'>){return <Table {...props} variant="secondary" className={'ds-data-table '+className}/>;}
export const DataTable=Object.assign(Root,{ScrollContainer:Table.ScrollContainer,Content:Table.Content,Header:Table.Header,Column:Table.Column,Body:Table.Body,Row:Table.Row,Cell:Table.Cell});
