/**
 * Test CALEGO przebiegu logowania i odczytu - prawdziwa przegladarka (Chromium
 * przez Playwrighta) na atrapie panelu o strukturze zgodnej z prawdziwym.
 *
 * Uruchomienie: node tests/panel-login.test.mjs
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { startFakePanel } from './fake-panel.mjs';

let playwrightAvailable = true;

try {
	await import( 'playwright' );
} catch {
	playwrightAvailable = false;
}

if ( ! playwrightAvailable ) {
	process.stdout.write( 'POMINIETE - brak playwright. Zainstaluj: npm install\n' );
	process.exit( 0 );
}

const { withPanel, collectDays, PanelLoginError } = await import( '../agent/panel-sync.mjs' );

// Bez zainstalowanego Chromium test sie pomija, a nie wywala.
try {
	const { chromium } = await import( 'playwright' );
	const probe = await chromium.launch( {
		headless: true,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
	} );

	await probe.close();
} catch {
	process.stdout.write( 'POMINIETE - brak przegladarki Chromium. Uruchom: npx playwright install chromium\n' );
	process.exit( 0 );
}

let passed = 0;
const failures = [];

function ok( condition, label ) {
	condition ? passed++ : failures.push( label );
}

function same( expected, actual, label ) {
	if ( expected === actual ) {
		passed++;
		return;
	}

	failures.push( `${ label }\n    oczekiwano: ${ JSON.stringify( expected ) }\n    otrzymano:  ${ JSON.stringify( actual ) }` );
}

const { server, state, url, credentials } = await startFakePanel();
const dir = mkdtempSync( join( tmpdir(), 'kv-login-' ) );
const sessionPath = join( dir, 'session.json' );

// --- pelny przebieg: logowanie + odczyt dni -------------------------------
{
	const logs = [];
	const days = await withPanel(
		{
			panelUrl: url,
			user: credentials.user,
			password: credentials.password,
			sessionPath,
			log: ( message ) => logs.push( message ),
		},
		( page ) => collectDays( page, { from: '2026-09-01', to: '2026-09-30' } )
	);

	same( 1, state.logins, 'pierwsze uruchomienie loguje się raz' );
	ok( existsSync( sessionPath ), 'sesja jest zapisana na dysk' );
	same( 2, days.length, 'zebrane oba dni z posiłkami (wygaszone pominięte)' );
	same( '2026-09-02', days[ 0 ].date, 'pierwszy dzień to środa' );
	same( 3, days[ 0 ].meals.length, 'środa ma trzy posiłki' );
	same( 'obiad', days[ 1 ].meals[ 0 ].slug, 'piątek ma obiad' );
	ok(
		days[ 0 ].meals[ 1 ].description.includes( 'Pierogi z ziemniakami' ),
		'opis posiłku przeszedł przez prawdziwą przeglądarkę'
	);
	ok(
		logs.some( ( line ) => line.includes( 'loguję się' ) ),
		'log mówi, że nastąpiło logowanie'
	);
}

// --- drugie uruchomienie: sesja z dysku, zero logowan ---------------------
{
	const logs = [];
	const days = await withPanel(
		{
			panelUrl: url,
			user: credentials.user,
			password: credentials.password,
			sessionPath,
			log: ( message ) => logs.push( message ),
		},
		( page ) => collectDays( page, { from: '2026-09-01', to: '2026-09-30' } )
	);

	same( 1, state.logins, 'drugie uruchomienie NIE loguje się ponownie' );
	same( 2, days.length, 'dane zebrane mimo pominięcia logowania' );
	ok(
		logs.some( ( line ) => line.includes( 'nadal ważna' ) ),
		'log mówi, że sesja została użyta ponownie'
	);
}

// --- szczegoly z bocznego panelu ------------------------------------------
{
	const days = await withPanel(
		{ panelUrl: url, user: credentials.user, password: credentials.password, sessionPath },
		( page ) => collectDays( page, { from: '2026-09-02', to: '2026-09-02', details: true } )
	);

	const lunch = days[ 0 ].meals.find( ( meal ) => 'obiad' === meal.slug );

	same(
		'mąka pszenna, ziemniaki, twaróg, boczek, kapusta kiszona',
		lunch.details[ 'Skład' ],
		'skład odczytany z bocznego panelu po kliknięciu'
	);
	same( 'gluten, mleko', lunch.details[ 'Alergeny' ], 'alergeny odczytane z bocznego panelu' );

	const breakfast = days[ 0 ].meals.find( ( meal ) => 'sniadanie' === meal.slug );

	ok(
		breakfast.details[ 'Szczegóły' ]?.includes( 'Kanapka' ),
		'posiłek bez rozpoznanych nagłówków dostaje surowy tekst'
	);
}

// --- zle haslo: czytelny komunikat ----------------------------------------
{
	let error = null;

	try {
		await withPanel(
			{ panelUrl: url, user: credentials.user, password: 'zle-haslo', timeout: 8000 },
			( page ) => collectDays( page, {} )
		);
	} catch ( caught ) {
		error = caught;
	}

	ok( error instanceof PanelLoginError, 'złe hasło daje błąd logowania, nie surowy timeout' );
	ok(
		/odrzucił logowanie|KV_PANEL_PASSWORD/.test( error?.message || '' ),
		'komunikat mówi, co sprawdzić'
	);
}

server.close();
rmSync( dir, { recursive: true, force: true } );

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
