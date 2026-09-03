#!/usr/bin/env node
/**
 * Publiczny jadlospis -> Arkusz Google. Bez logowania do panelu.
 *
 *   npm run sheet                 codzienne uruchomienie
 *   npm run sheet:dry             pokazuje, co by zapisal, i nic nie rusza
 *   npm run sheet:create          zaklada nowy arkusz i wypisuje jego numer
 *   node agent/sync-public-to-sheet.mjs --out menu.json    sam odczyt
 *
 * Zasada jak wszedzie w tym projekcie: NIC NIE ZNIKA. Kolejne uruchomienia
 * dopisuja nowe dni i poprawiaja zmienione, ale nigdy nie kasuja wierszy -
 * takze tych dopisanych recznie.
 *
 * Konfiguracja w agent/.env - patrz agent/.env.example i docs/ARKUSZE.md.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readPublicMenu } from './public-menu.mjs';
import { createSheetsClient, saveToSheet } from './sheets.mjs';
import { saveArchive } from './archive.mjs';

const HERE = dirname( fileURLToPath( import.meta.url ) );

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

function requireEnv( keys ) {
	const missing = keys.filter( ( key ) => ! process.env[ key ] );

	if ( missing.length ) {
		throw new Error(
			`Brakuje w konfiguracji: ${ missing.join( ', ' ) }. Uzupełnij agent/.env — ` +
				'jak zdobyć te dane, opisuje docs/ARKUSZE.md.'
		);
	}
}

/** Rozwija ~ i tworzy katalog docelowy - inaczej zapis archiwum by padl. */
function preparePath( path ) {
	const expanded = path.startsWith( '~/' ) ? join( homedir(), path.slice( 2 ) ) : path;
	const full = resolve( expanded );

	mkdirSync( dirname( full ), { recursive: true } );

	return full;
}

/**
 * Te same dane logowania co przy Kalendarzu Google. Przy zwyklym koncie gmail
 * dziala refresh token; konto uslugowe wymaga udostepnienia mu arkusza.
 */
function googleConfigFromEnv() {
	if ( process.env.GOOGLE_REFRESH_TOKEN ) {
		requireEnv( [ 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET' ] );

		return {
			clientId: process.env.GOOGLE_CLIENT_ID,
			clientSecret: process.env.GOOGLE_CLIENT_SECRET,
			refreshToken: process.env.GOOGLE_REFRESH_TOKEN,
		};
	}

	requireEnv( [ 'GOOGLE_SERVICE_ACCOUNT_EMAIL', 'GOOGLE_PRIVATE_KEY' ] );

	return {
		serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
		privateKey: process.env.GOOGLE_PRIVATE_KEY,
		subject: process.env.GOOGLE_SUBJECT,
	};
}

async function main() {
	const flags = parseArgs( process.argv.slice( 2 ) );
	const log = flags.quiet ? () => {} : ( message = '' ) => process.stdout.write( `${ message }\n` );
	const sheetName = ( typeof flags.tab === 'string' ? flags.tab : process.env.GOOGLE_SHEET_TAB ) || 'Jadłospis';

	// Zakladanie arkusza to osobne, jednorazowe zadanie - nic wiecej wtedy nie robimy.
	if ( flags.create ) {
		const client = createSheetsClient( { ...googleConfigFromEnv(), fetch: globalThis.fetch } );
		const title = 'string' === typeof flags.create ? flags.create : 'Kuchnia Vikinga — jadłospis';
		const spreadsheetId = await client.create( title, sheetName );

		log( `Arkusz „${ title }” założony.` );
		log( '' );
		log( `  GOOGLE_SHEET_ID=${ spreadsheetId }` );
		log( '' );
		log( `Wklej tę linię do agent/.env, a arkusz masz tutaj:` );
		log( `  https://docs.google.com/spreadsheets/d/${ spreadsheetId }` );

		return;
	}

	const site = ( typeof flags.site === 'string' ? flags.site : process.env.KV_PUBLIC_URL ) || 'https://kuchniavikinga.pl';

	log( `Czytam publiczny jadłospis: ${ site }` );

	const days = await readPublicMenu( { site, log, fetch: globalThis.fetch } );

	if ( typeof flags.out === 'string' ) {
		writeFileSync( flags.out, JSON.stringify( days, null, 2 ), 'utf8' );
		log( `Zapisano ${ flags.out }` );
	}

	// Archiwum CSV dopisuje sie zawsze, gdy jest skonfigurowane - to kopia
	// zapasowa na wypadek klopotow z Arkuszami.
	const archivePath = typeof flags.archive === 'string' ? flags.archive : process.env.KV_ARCHIVE_CSV;

	if ( archivePath && days.length && ! flags[ 'dry-run' ] ) {
		const archive = saveArchive( preparePath( archivePath ), days );

		log( `Archiwum ${ archive.path }: ${ archive.after } wierszy (+${ archive.added }).` );
	}

	if ( flags.out ) {
		return;
	}

	if ( 0 === days.length ) {
		log( 'Nie ma czego zapisywać — kończę bez ruszania arkusza.' );

		return;
	}

	const client = createSheetsClient( { ...googleConfigFromEnv(), fetch: globalThis.fetch } );
	const report = await saveToSheet( client, days, {
		spreadsheetId: typeof flags.sheet === 'string' ? flags.sheet : process.env.GOOGLE_SHEET_ID,
		sheetName,
		dryRun: Boolean( flags[ 'dry-run' ] ),
	} );

	log(
		flags[ 'dry-run' ]
			? `Próba na sucho: w arkuszu jest ${ report.before } wierszy, byłoby ${ report.after } (+${ report.added }).`
			: `Arkusz: ${ report.after } wierszy (+${ report.added }). Nic nie usunięto.`
	);
	log( `  ${ report.url }` );
}

main().catch( ( error ) => {
	process.stderr.write( `Błąd: ${ error.message }\n` );
	process.exitCode = 1;
} );
