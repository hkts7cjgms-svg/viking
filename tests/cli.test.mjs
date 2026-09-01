/**
 * Test CLI na atrapie API. Uruchomienie: node tests/cli.test.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync } from 'node:fs';
import { startMockApi } from './mock-api.mjs';

const run = promisify( execFile );
const CLI = join( dirname( fileURLToPath( import.meta.url ) ), '..', 'agent', 'kv-events.mjs' );

let passed = 0;
const failures = [];

function ok( condition, label ) {
	if ( condition ) {
		passed++;
		return;
	}

	failures.push( label );
}

const { server, port } = await startMockApi();

const env = {
	...process.env,
	KV_SITE_URL: `http://127.0.0.1:${ port }`,
	KV_USER: 'agent',
	KV_APP_PASSWORD: 'haslo aplikacji',
};

async function cli( args, extraEnv = {} ) {
	try {
		const { stdout } = await run( process.execPath, [ CLI, ...args ], { env: { ...env, ...extraEnv } } );

		return { stdout, failed: false };
	} catch ( error ) {
		return { stdout: error.stdout || '', stderr: error.stderr || '', failed: true };
	}
}

const meta = await cli( [ 'meta' ] );
ok( ! meta.failed && meta.stdout.includes( '"obiad"' ), 'meta zwraca słownik posiłków' );

const added = await cli( [
	'add',
	'--title', 'Dzień Kuchni Polskiej',
	'--from', '2026-09-15',
	'--to', '2026-09-15',
	'--meals', 'obiad',
	'--diets', 'smart',
	'--body', 'Dziś obiad z pomysłem.',
] );
ok( ! added.failed && /Dodano #\d+/.test( added.stdout ), 'add tworzy wydarzenie' );

const id = Number( added.stdout.match( /#(\d+)/ )?.[ 1 ] );
ok( Number.isInteger( id ), 'add zwraca ID nowego wydarzenia' );

const listed = await cli( [ 'list' ] );
ok( listed.stdout.includes( 'Dzień Kuchni Polskiej' ), 'list pokazuje dodane wydarzenie' );
ok( listed.stdout.includes( 'obiad' ) && listed.stdout.includes( 'smart' ), 'list pokazuje posiłki i diety' );

const day = await cli( [ 'day', '2026-09-15' ] );
ok( day.stdout.includes( '2026-09-15: 1 wydarzeń' ), 'day liczy wydarzenia danego dnia' );

const range = await cli( [ 'range', '2026-09-14', '2026-09-16' ] );
ok( range.stdout.includes( '2026-09-15 (1)' ), 'range pokazuje dzień z wydarzeniem' );
ok( ! range.stdout.includes( '2026-09-14' ), 'range domyślnie pomija dni puste' );

const rangeAll = await cli( [ 'range', '2026-09-14', '2026-09-16', '--all' ] );
ok( rangeAll.stdout.includes( '2026-09-14 (0)' ), 'range --all pokazuje też dni puste' );

const edited = await cli( [ 'edit', String( id ), '--priority', '10' ] );
ok( ! edited.failed && edited.stdout.includes( `Zapisano #${ id }` ), 'edit zapisuje zmianę' );

const afterEdit = await cli( [ 'get', String( id ) ] );
ok( afterEdit.stdout.includes( '"priority": 10' ), 'edit faktycznie zmienił priorytet' );

const noAuth = await cli( [ 'add', '--title', 'Bez hasła' ], { KV_APP_PASSWORD: '' } );
ok( noAuth.failed && noAuth.stderr.includes( 'KV_APP_PASSWORD' ), 'brak hasła aplikacji zatrzymuje zapis' );

const noTitle = await cli( [ 'add', '--body', 'sam opis' ] );
ok( noTitle.failed && noTitle.stderr.includes( '--title' ), 'add bez tytułu kończy się błędem' );

const calendar = await cli( [ 'calendar' ] );
ok( calendar.stdout.startsWith( 'BEGIN:VCALENDAR' ), 'calendar wypisuje kanał iCal' );
ok( calendar.stdout.includes( 'Dzień Kuchni Polskiej' ), 'kanał zawiera dodane wydarzenie' );

const icsPath = join( tmpdir(), `kv-test-${ process.pid }.ics` );
const saved = await cli( [ 'calendar', '--out', icsPath ] );
ok( saved.stdout.includes( '1 wydarzeń' ), 'calendar --out raportuje liczbę wydarzeń' );
ok( readFileSync( icsPath, 'utf8' ).includes( 'BEGIN:VEVENT' ), 'calendar --out zapisuje plik' );
rmSync( icsPath, { force: true } );

const removed = await cli( [ 'rm', String( id ), '--force' ] );
ok( ! removed.failed && removed.stdout.includes( 'Usunięto trwale' ), 'rm --force usuwa wydarzenie' );

const missing = await cli( [ 'get', String( id ) ] );
ok( missing.failed && missing.stderr.includes( 'Nie znaleziono' ), 'usunięte wydarzenie znika' );

server.close();

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
