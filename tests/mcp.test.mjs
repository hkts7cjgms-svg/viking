/**
 * Test serwera MCP na atrapie API. Uruchomienie: node tests/mcp.test.mjs
 */
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { startMockApi } from './mock-api.mjs';

const SERVER = join( dirname( fileURLToPath( import.meta.url ) ), '..', 'agent', 'mcp-server.mjs' );

let passed = 0;
const failures = [];

function ok( condition, label ) {
	condition ? passed++ : failures.push( label );
}

const { server, port } = await startMockApi();

const child = spawn( process.execPath, [ SERVER ], {
	env: {
		...process.env,
		KV_SITE_URL: `http://127.0.0.1:${ port }`,
		KV_USER: 'agent',
		KV_APP_PASSWORD: 'haslo aplikacji',
	},
	stdio: [ 'pipe', 'pipe', 'inherit' ],
} );

const pending = new Map();

createInterface( { input: child.stdout } ).on( 'line', ( line ) => {
	const message = JSON.parse( line );
	const resolve = pending.get( message.id );

	if ( resolve ) {
		pending.delete( message.id );
		resolve( message );
	}
} );

let nextId = 1;

function request( method, params ) {
	const id = nextId++;

	return new Promise( ( resolve, reject ) => {
		pending.set( id, resolve );
		child.stdin.write( `${ JSON.stringify( { jsonrpc: '2.0', id, method, params } ) }\n` );
		setTimeout( () => reject( new Error( `Timeout na ${ method }` ) ), 5000 );
	} );
}

/** Wyciaga JSON z pola content[0].text odpowiedzi tools/call. */
function toolPayload( message ) {
	return JSON.parse( message.result.content[ 0 ].text );
}

const init = await request( 'initialize', { protocolVersion: '2024-11-05', capabilities: {} } );
ok( init.result?.serverInfo?.name === 'kuchnia-vikinga-wydarzenia', 'initialize przedstawia serwer' );
ok( Boolean( init.result?.capabilities?.tools ), 'initialize deklaruje wsparcie dla narzędzi' );

const tools = await request( 'tools/list', {} );
const names = tools.result.tools.map( ( tool ) => tool.name );
ok( names.includes( 'kv_add_event' ), 'tools/list wystawia kv_add_event' );
ok( names.includes( 'kv_update_event' ), 'tools/list wystawia kv_update_event' );
ok( names.includes( 'kv_delete_event' ), 'tools/list wystawia kv_delete_event' );
ok( names.includes( 'kv_get_range' ), 'tools/list wystawia kv_get_range' );
ok(
	tools.result.tools.every( ( tool ) => tool.inputSchema?.type === 'object' ),
	'każde narzędzie ma schemat wejścia'
);

const added = await request( 'tools/call', {
	name: 'kv_add_event',
	arguments: {
		title: 'Dzień Kuchni Polskiej',
		date_from: '2026-09-15',
		date_to: '2026-09-15',
		meals: [ 'obiad' ],
		diets: [ 'smart' ],
		body: 'Dziś obiad z pomysłem.',
	},
} );
const created = toolPayload( added );
ok( created.title === 'Dzień Kuchni Polskiej', 'kv_add_event tworzy wydarzenie' );
ok( created.meals.includes( 'obiad' ), 'kv_add_event zapisuje posiłki' );

const day = await request( 'tools/call', { name: 'kv_get_day', arguments: { date: '2026-09-15' } } );
ok( toolPayload( day ).count === 1, 'kv_get_day widzi nowe wydarzenie' );

const range = await request( 'tools/call', {
	name: 'kv_get_range',
	arguments: { from: '2026-09-14', to: '2026-09-16' },
} );
ok( toolPayload( range ).days.length === 1, 'kv_get_range zwraca tylko dni z wydarzeniami' );
ok( toolPayload( range ).days[ 0 ].date === '2026-09-15', 'kv_get_range trafia w dobry dzień' );

const updated = await request( 'tools/call', {
	name: 'kv_update_event',
	arguments: { id: created.id, priority: 5 },
} );
ok( toolPayload( updated ).priority === 5, 'kv_update_event zmienia priorytet' );
ok( toolPayload( updated ).title === 'Dzień Kuchni Polskiej', 'kv_update_event nie kasuje pozostałych pól' );

const removed = await request( 'tools/call', {
	name: 'kv_delete_event',
	arguments: { id: created.id, force: true },
} );
ok( toolPayload( removed ).deleted === true, 'kv_delete_event usuwa wydarzenie' );

const missing = await request( 'tools/call', { name: 'kv_get_day', arguments: { date: '2026-09-15' } } );
ok( toolPayload( missing ).count === 0, 'po usunięciu dzień jest pusty' );

const unknown = await request( 'tools/call', { name: 'kv_nie_ma_takiego', arguments: {} } );
ok( unknown.error?.code === -32602, 'nieznane narzędzie zwraca błąd protokołu' );

const badCall = await request( 'tools/call', { name: 'kv_update_event', arguments: { id: 999999 } } );
ok( badCall.result?.isError === true, 'błąd API wraca jako isError, nie jako wywrotka serwera' );

child.kill();
server.close();

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
