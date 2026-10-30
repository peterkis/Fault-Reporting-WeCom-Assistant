import {listPackage,extractFile} from '@electron/asar';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {readConfig} from './policy.mjs';
const root=process.cwd(),release=path.join(root,'.local/electron/releases'),archive=path.join(release,'win-unpacked/resources/app.asar');
const allowed=['desktop.config.json','icon.ico','icon.png','main.mjs','package.json','policy.mjs','preload.cjs','unavailable.html','chrome.html','login-chrome.html','chrome.css','chrome.mjs','chrome-preload.cjs'];
const actual=listPackage(archive,{isPack:false}).map(file=>file.replaceAll('\\','/').replace(/^\//u,'')).sort();
if(JSON.stringify(actual)!==JSON.stringify([...allowed].sort()))throw Error('DESKTOP_PACKAGE_ALLOWLIST_MISMATCH:'+actual.filter(file=>!allowed.includes(file)).slice(0,5).join(','));
const config=readConfig(JSON.parse(extractFile(archive,'desktop.config.json').toString('utf8').replace(/^\uFEFF/u,'')) as unknown);
for(const file of ['main.mjs','policy.mjs','preload.cjs','chrome.mjs','chrome-preload.cjs']){
  if(!extractFile(archive,file).equals(readFileSync(path.join(root,'.local/electron/compiled',file))))throw Error('DESKTOP_PACKAGE_COMPILED_DRIFT:'+file);
}
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const packageInfo:unknown=JSON.parse(extractFile(archive,'package.json').toString('utf8').replace(/^\uFEFF/u,''));
if(!packageInfo||typeof packageInfo!=='object'||!('version' in packageInfo)||typeof packageInfo.version!=='string'||!/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/u.test(packageInfo.version))throw Error('DESKTOP_PACKAGE_VERSION_INVALID');
// Select the exact current version without requiring deletion of older rollback installers.
const file='Yixiaoxiu-Workbench-'+packageInfo.version+'-x64-Setup.exe';
if(!readdirSync(release).includes(file))throw Error('DESKTOP_EXACT_INSTALLER_REQUIRED');
const manifest={schemaVersion:1,serverOrigin:config.serverOrigin,installer:{file,bytes:readFileSync(path.join(release,file)).length,sha256:sha(readFileSync(path.join(release,file)))},asarSha256:sha(readFileSync(archive)),files:allowed.map(file=>({file,sha256:sha(extractFile(archive,file))})),lockSha256:sha(readFileSync(path.join(root,'package-lock.json'))),signed:false};
writeFileSync(path.join(release,'desktop-build.json'),JSON.stringify(manifest,null,2)+'\n');
writeFileSync(path.join(release,file+'.sha256'),manifest.installer.sha256+'  '+file+'\n');
console.log(JSON.stringify(manifest));
