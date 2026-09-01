#!/usr/bin/env node
/**
 * Cały łańcuch w jednym poleceniu: logowanie do panelu, odczyt jadlospisu,
 * zapis do Kalendarza Google. To jest to, co uruchamia cron.
 *
 *   node agent/sync-to-calendar.mjs --days 21
 *   node agent/sync-to-calendar.mjs --dry-run          (nic nie zapisuje)
 *   node agent/sync-to-calendar.mjs --out menu.json    (sam odczyt, bez kalendarza)
 *
 * Konfiguracja w agent/.env - patrz agent/.env.example.
 */

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from './google-calendar.mjs';
import { planSync, applySync } from './calendar-sync.mjs';

const HERE = dirname( fileURLToPath( import.meta.url ) );

function loadDotEnv() {
	for ( const candidate of [ join( HERE, '.env' ), join( HERE, '..', '.env' ) ] ) {
		if ( ! existsSync( candidate ) ) {
			continue;
		}

		for ( const line of readFileSync( candidate, 'utf8' ).split( '\n' ) ) {
			const match = line.match( /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/ );

			if ( match && process.env[ match[ 1 ] ] === undefined ) {
				process.env[ match[ 1 ] ] = match[ 2 ].replace( /^["']|["']$/g, '' );
			}
		}
	}
}

loadDotEnv();

function parseArgs( argv ) {
	const flags = {};

	for ( let i = 0; i < argv.length; i++ ) {
		if ( ! argv[ i ].startsWith( '--' ) ) {
			continue;
		}

		const key = argv[ i ].slice( 2 );
		const next = argv[ i + 1 ];

		if ( next === undefined || next.startsWith( '--' ) ) {
			flags[ key ] = true;
			continue;
		}

		flags[ key ] = next;
		i++;
	}

	return flags;
}

function today() {
	return new Date().toISOString().slice( 0, 10 );
}

function addDays( date, days ) {
	const parsed = new Date( `${ date }T00:00:00Z` );

	parsed.setUTCDate( parsed.getUTCDate() + days );

	return parsed.toISOString().slice( 0, 10 );
}

function requireEnv( keys ) {
	const missing = keys.filter( ( key ) => ! process.env[ key ] );

	if ( missing.length ) {
		throw new Error( `Brakuje w konfiguracji: ${ missing.join( ', ' ) }. Uzupełnij agent/.env.` );
	}
}

function googleConfigFromEnv() {
	if ( process.env.GOOGLE_REFRESH_TOKEN ) {
		requireEnv( [ 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET' ] );

		return {
			calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
			clientId: process.env.GOOGLE_CLIENT_ID,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET,
			refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
		};
	}

	requireEnv( [ 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY' ] );

	return {
		calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
		serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
		privateKey: process.env.GOOGLE_PRIVATE_KEY,
		subject: process.env.GOOGLE_SUBJECT,
	};
}

async function main() {
	const flags = parseArgs( process.argv.slice( 2 ) );
	const log = flags.quiet ? () => {} : ( message ) => process.stdout.write( `${ message }\n` );

	const from = typeof flags.from === 'string' ? flags.from : today();
	const to =
		typeof flags.to === 'string'
			? flags.to
			: addDays( from, Math.max( 0, Number( flags.days || 21 ) - 1 ) );

	requireEnv( [ 'KV_PANEL_URL', 'KV_PANEL_USER', 'KV_PANEL_PASSWORD' ] );

	const { withPanel, collectDays } = await import( './panel-sync.mjs' );

	log( `Zakres: ${ from } → ${ to }` );

	const days = await withPanel(
		{
			panelUrl: process.env.KV_PANEL_URL,
			user: process.env.KV_PANEL_USER,
			password: process.env.KV_PANEL_PASSWORD,
			headless: '0' !== process.env.KV_HEADLESS,
			log,
		},
		( page ) => collectDays( page, { from, to, log } )
	);

	log( `Pobrano ${ days.length } dni z jadłospisem.` );

	if ( typeof flags.out === 'string' ) {
		writeFileSync( flags.out, JSON.stringify( days, null, 2 ), 'utf8' );
		log( `Zapisano ${ flags.out }` );

		return;
	}

	if ( 0 === days.length ) {
		log( 'Nie ma czego zapisywać — kończę bez ruszania kalendarza.' );

		return;
	}

	const client = createClient( { ...googleConfigFromEnv(), fetch: globalThis.fetch } );
	const existing = await client.listManaged( from, to );

	log( `W kalendarzu jest już ${ existing.length } wpisów z tej synchronizacji.` );

	const plan = planSync( days, existing, {
		title: process.env.KV_CALENDAR_TITLE || 'Jadłospis — Kuchnia Vikinga',
	} );

	log(
		`Plan: ${ plan.insert.length } nowych, ${ plan.patch.length } do poprawki, ` +
			`${ plan.remove.length } do usunięcia, ${ plan.unchanged.length } bez zmian.`
	);

	const report = await applySync( client, plan, {
		dryRun: Boolean( flags[ 'dry-run' ] ),
		onProgress: ( action, day ) => log( `  ${ action }: ${ day }` ),
	} );

	log(
		flags[ 'dry-run' ]
			? 'Próba na sucho — kalendarz nietknięty.'
			: `Gotowe: +${ report.inserted } / ~${ report.patched } / -${ report.removed }`
	);
}

main().catch( ( error ) => {
	process.stderr.write( `Błąd: ${ error.message }\n` );
	process.exitCode = 1;
} );
