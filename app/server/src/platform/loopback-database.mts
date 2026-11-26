import {AsyncLocalStorage} from 'node:async_hooks';
import {Socket,type NetConnectOpts} from 'node:net';
import type {ClientConfig} from 'pg';
import {parse as parsePgConnectionString,toClientConfig} from 'pg-connection-string';

export interface LocalMigrationDatabase extends Pick<ClientConfig,'database'|'user'|'password'|'ssl'|'sslnegotiation'|'client_encoding'|'options'|'stream'> {
  host:string;
  hostaddr:'127.0.0.1'|'::1';
  port:number;
}

// pg uses its host for TLS and pgpass. Change only the transport's connect
// destination, after pg has selected the logical host and port for this client.
class LocalhostSocket extends Socket {
  override connect(port:number|string|NetConnectOpts,hostOrListener?:string|(()=>void),listener?:()=>void):this{
    if(typeof port!=='number'||typeof hostOrListener!=='string'||hostOrListener.toLowerCase()!=='localhost')
      throw Error('LOOPBACK_SOCKET_DESTINATION_INVALID');
    return listener?super.connect(port,'127.0.0.1',listener):super.connect(port,'127.0.0.1');
  }
}
export const localhostStream=()=>new LocalhostSocket();

function validateLoopbackEndpoint(raw:string) {
  const parsed=new URL(raw);
  const normalizeHost=(host:string)=>host.toLowerCase()==='[::1]'?'::1':host.toLowerCase();
  const host=normalizeHost(parsed.hostname);
  if(!['postgres:','postgresql:'].includes(parsed.protocol)||!['127.0.0.1','localhost','::1'].includes(host)){
    throw new Error('PERF_BOARD_REQUIRES_LOOPBACK_DATABASE');
  }
  const literal:'127.0.0.1'|'::1'=host==='::1'?'::1':'127.0.0.1';
  const port=parsed.port||'5432';
  const driver=parsePgConnectionString(raw);
  const driverHost=driver.host||process.env.PGHOST||'localhost';
  const driverPort=driver.port||process.env.PGPORT||'5432';
  const hostaddr=driver.hostaddr||process.env.PGHOSTADDR;
  const address=typeof hostaddr==='string'?normalizeHost(hostaddr):hostaddr;
  if(Number(port)<1||normalizeHost(driverHost)!==host||!/^\d+$/u.test(driverPort)||Number(driverPort)!==Number(port)
    ||(address!==undefined&&address!==literal&&!(host==='localhost'&&address==='::1'))){
    throw new Error('PERF_BOARD_DATABASE_DESTINATION_MISMATCH');
  }
  // pg normalizes a bare ssl=no-verify after parsing; toClientConfig drops string values.
  if(typeof driver.ssl==='string'&&driver.ssl!==''&&driver.ssl!=='no-verify')
    throw new Error('LOOPBACK_DATABASE_SSL_OPTION_INVALID');
  return {host,literal,port,driver,driverHost,address};
}

// Caller-owned suites keep pg's original host, address family, credentials and URL options.
export function checkedLoopbackDatabaseUrl(raw:string):string {
  validateLoopbackEndpoint(raw);
  return raw;
}

export function assertLoopbackDatabaseUrl(raw:string):LocalMigrationDatabase {
  const {host,literal,port,driver,driverHost,address}=validateLoopbackEndpoint(raw);
  if(address!==undefined&&address!==literal)throw new Error('PERF_BOARD_DATABASE_DESTINATION_MISMATCH');
  const {database,user,password,ssl,sslnegotiation,client_encoding,options}=toClientConfig(driver);
  const effectiveSsl=driver.ssl==='no-verify'?{rejectUnauthorized:false}
    :driver.ssl===''?false:typeof ssl==='object'?{...ssl}:ssl;
  return {host:host==='localhost'?driverHost:literal,hostaddr:literal,...(host==='localhost'?{stream:localhostStream}:{}),port:Number(port),database,user,password,ssl:effectiveSsl,sslnegotiation,client_encoding,options};
}

// Keep the logical URL for legacy fixture callbacks and subprocesses (including
// callers that require a URL without query parameters).
export function loopbackFixtureTarget(raw:string){
  const connection=assertLoopbackDatabaseUrl(raw);
  const {host,port}=connection;
  const url=new URL(raw);
  url.hostname=host==='::1'?'[::1]':host;
  url.port=String(port);
  url.searchParams.delete('port');
  url.searchParams.delete('host');
  if(url.searchParams.has('hostaddr'))url.searchParams.set('hostaddr',connection.hostaddr);
  url.searchParams.delete('dbname');
  return {connection,databaseUrl:url.toString()};
}

export function loopbackFixtureUrl(raw:string):string{
  return loopbackFixtureTarget(raw).databaseUrl;
}

// Some fixture callbacks call string-only migration entry points. Pin only the
// database owned by this callback, including variants with session options.
const ownedMigrationTarget = new AsyncLocalStorage<URL>();
export function withFixtureMigrations<T>(databaseUrl:string, run:()=>T):T {
  return ownedMigrationTarget.run(new URL(databaseUrl),run);
}

export function fixtureMigrationConnection(raw:string):ClientConfig {
  const owned=ownedMigrationTarget.getStore();
  if(!owned)return {connectionString:raw};
  const url=URL.parse(raw);
  if(!url || url.protocol!==owned.protocol || url.pathname!==owned.pathname
    || url.hostname.toLowerCase()!==owned.hostname.toLowerCase() || (url.port||'5432')!==(owned.port||'5432')){
    return {connectionString:raw};
  }
  return assertLoopbackDatabaseUrl(raw);
}
