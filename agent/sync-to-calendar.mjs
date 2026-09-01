#!/usr/bin/env node
/**
 * Cały łańcuch w jednym poleceniu: logowanie do panelu, odczyt jadlospisu,
 * zapis do Kalendarza Google. To jest to, co uruchamia cron.
 *
 *   node agent/sync-to-calendar.mjs --days 21
 *   node agent/sync-to-calendar.mjs --dry-run             (nic nie zapisuje)
 *   node agent/sync-to-calendar.mjs --out menu.json       (sam odczyt, bez kalendarza)
 *   node agent/sync-to-calendar.mjs --target google       (zamiast Kalendarza Apple)
 *
 * Domyslnie zapisuje do Kalendarza Apple i NIGDY nic nie usuwa - dzien, ktory
 * zniknal z panelu, zostaje w kalendarzu i w archiwum. Kasowanie wlacza --remove.
 *
 * Konfiguracja w agent/.env - patrz agent/.env.example.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from './google-calendar.mjs';
import { planSync, applySync } from './calendar-sync.mjs';
import { syncToAppleCalendar, isSupported, DEFAULT_CALENDAR } from './apple-calendar.mjs';
import { saveArchive } from './archive.mjs';

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

/** Rozwija ~ i tworzy katalog docelowy - inaczej zapis archiwum by padl. */
function preparePath( path ) {
	const expanded = path.startsWith( '~/' ) ? join( homedir(), path.slice( 2 ) ) : path;
	const full = resolve( expanded );

	mkdirSync( dirname( full ), { recursive: true } );

	return full;
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
			// Zapamietana sesja - codzienne uruchomienie zwykle w ogole sie nie loguje.
			sessionPath: join( HERE, '.session.json' ),
			log,
		},
		( page ) =>
			collectDays( page, {
				from,
				to,
				log,
				// Wchodzenie w kazdy posilek wydluza przebieg, wiec domyslnie wylaczone.
				details: Boolean( flags.details ) || '1' === process.env.KV_FETCH_DETAILS,
			} )
	);

	log( `Pobrano ${ days.length } dni z jadłospisem.` );

	if ( typeof flags.out === 'string' ) {
		writeFileSync( flags.out, JSON.stringify( days, null, 2 ), 'utf8' );
		log( `Zapisano ${ flags.out }` );
	}

	// Archiwum jest niezalezne od kalendarza - dopisuje sie zawsze i nic nie gubi.
	const archivePath = typeof flags.archive === 'string' ? flags.archive : process.env.KV_ARCHIVE_CSV;

	if ( archivePath && days.length ) {
		const archive = saveArchive( preparePath( archivePath ), days );

		log( `Archiwum ${ archive.path }: ${ archive.after } wierszy (+${ archive.added }).` );
	}

	if ( flags.out ) {
		return;
	}

	if ( 0 === days.length ) {
		log( 'Nie ma czego zapisywać — kończę bez ruszania kalendarza.' );

		return;
	}

	const title = process.env.KV_CALENDAR_TITLE || 'Jadłospis — Kuchnia Vikinga';
	const target = ( typeof flags.target === 'string' ? flags.target : process.env.KV_CALENDAR_TARGET ) || 'apple';

	if ( 'apple' === target ) {
		await syncApple( days, { title, flags, log } );

		return;
	}

	if ( 'google' !== target ) {
		throw new Error( `Nieznany cel: ${ target }. Użyj --target apple albo --target google.` );
	}

	await syncGoogle( days, { title, from, to, flags, log } );
}

async function syncApple( days, { title, flags, log } ) {
	if ( ! isSupported() ) {
		throw new Error(
			'Kalendarz Apple działa tylko na macOS. Na innym systemie użyj --target google.'
		);
	}

	const calendarName = process.env.KV_APPLE_CALENDAR || DEFAULT_CALENDAR;

	log( `Kalendarz Apple: „${ calendarName }”` );

	const report = await syncToAppleCalendar( days, {
		calendarName,
		title,
		dryRun: Boolean( flags[ 'dry-run' ] ),
	} );

	for ( const error of report.errors ) {
		process.stderr.write( `  ! ${ error }\n` );
	}

	if ( report.errors.length && ! report.created && ! report.updated ) {
		throw new Error( 'Nie udało się zapisać nic do kalendarza.' );
	}

	log(
		flags[ 'dry-run' ]
			? `Próba na sucho: dodałbym ${ report.created }, poprawił ${ report.updated }, ` +
					`${ report.unchanged } bez zmian.`
			: `Gotowe: +${ report.created } nowych, ~${ report.updated } poprawionych, ` +
					`${ report.unchanged } bez zmian. Nic nie usunięto.`
	);
}

async function syncGoogle( days, { title, from, to, flags, log } ) {
	const client = createClient( { ...googleConfigFromEnv(), fetch: globalThis.fetch } );
	const existing = await client.listManaged( from, to );

	log( `W kalendarzu jest już ${ existing.length } wpisów z tej synchronizacji.` );

	const plan = planSync( days, existing, {
		title,
		// Usuwanie jest swiadoma decyzja, nie domyslnym zachowaniem.
		removeMissing: Boolean( flags.remove ),
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
