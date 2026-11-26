import type {ClientConfig} from 'pg';

import {fixtureMigrationConnection,localhostStream,type LocalMigrationDatabase} from '../src/platform/loopback-database.mjs';
export type {LocalMigrationDatabase} from '../src/platform/loopback-database.mjs';
export type MigrationDatabase = string | LocalMigrationDatabase;

export function isMigrationDatabase(value:unknown):value is MigrationDatabase {
  if(typeof value==='string')return value.length>0;
  return typeof value==='object'&&value!==null&&'host' in value&&typeof value.host==='string'&&['127.0.0.1','::1','localhost'].includes(value.host.toLowerCase())
    &&'port' in value&&typeof value.port==='number'&&Number.isInteger(value.port)&&value.port>0&&value.port<=65535;
}

export function migrationConnection(database:MigrationDatabase):ClientConfig {
  if(!isMigrationDatabase(database))throw Error('MIGRATION_DATABASE_REQUIRED');
  if(typeof database==='string')return fixtureMigrationConnection(database);
  const {host,port,user,password,ssl,sslnegotiation,client_encoding,options}=database;
  return {host,...(host.toLowerCase()==='localhost'?{stream:localhostStream}:{}),port,database:database.database,user,password,ssl,sslnegotiation,client_encoding,options};
}
