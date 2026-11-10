import type {ServerResponse} from 'node:http';
import type {YxxNativeHttpOptions} from '../../app/server/src/yxx-self-service-native-http.mjs';

/** Fixed marker present only in the stub shell, so tests can prove when the shell was (not) rendered. */
export const H5_SHELL_MARKER='data-h5-shell-stub';
/** Test-only stand-in for the enabled compiled H5 static presentation (`createYxxH5Static`).
 * Like the production shell, it carries no member data and renders whenever the host asks;
 * every authentication and ownership decision stays with the actual native handler. It serves
 * no assets, so asset requests fall through to the handler unchanged. */
export function createH5ShellStub():NonNullable<YxxNativeHttpOptions['h5Static']>{
 return Object.freeze({enabled:true,
  async page(response:ServerResponse){const html=Buffer.from('<!doctype html><html '+H5_SHELL_MARKER+'><body><div id="root"></div></body></html>');response.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-length':html.length});response.end(html);return true;},
  async asset(){return false;},
 });
}
