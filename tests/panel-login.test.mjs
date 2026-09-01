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
	same( 2, days.length, 'zebrane oba dni z posiłkami, dni bez etykiety pominięte' );
	// 2026-09-02 ma klasę is-disabled, a mimo to pełny jadłospis - dokładnie jak
	// w prawdziwym panelu. Pomijanie takich dni było błędem, który to wyłapuje.
	same( '2026-09-02', days[ 0 ].date, 'dzień oznaczony is-disabled też jest pobierany' );
	same( 3, days[ 0 ].meals.length, 'środa ma trzy posiłki' );
	same( 'obiad', days[ 1 ].meals[ 0 ].slug, 'piątek ma obiad' );
	// Panel dociąga posiłki z opóźnieniem — przez chwilę wiszą dania poprzedniego
	// dnia. Odczyt w tym momencie zapisałby cudzy jadłospis pod złą datą.
	same( 1, days[ 1 ].meals.length, 'piątek ma własną liczbę posiłków, nie trzy ze środy' );
	ok(
		days[ 1 ].meals[ 0 ].description.includes( 'Gulasz' ),
		'jadłospis piątku nie jest przeterminowaną kopią środy'
	);
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
		'mąka pszenna, TWARÓG PÓŁTŁUSTY (MLEKO), boczek, CHLEB (GLUTEN), kapusta kiszona',
		lunch.details[ 'Składniki' ],
		'skład odczytany z okna szczegółów po kliknięciu'
	);
	// Alergeny panel wyróżnia grubszą czcionką - stąd je bierzemy.
	same(
		'TWARÓG PÓŁTŁUSTY (MLEKO), CHLEB (GLUTEN)',
		lunch.details[ 'Alergeny' ],
		'alergeny wyłuskane z wyróżnionych składników'
	);
	same( 'Na zimno', lunch.details[ 'Podanie' ], 'sposób podania odczytany' );
	same( '46.7g', lunch.details[ 'Białko' ], 'wartości odżywcze z okna szczegółów' );

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

// --- baner zgod bez rozpoznawalnego przycisku ---------------------------
// Ostatnia deska ratunku: usuniecie nakladki z DOM. Bez tego logowanie
// konczy sie bledem "CybotCookiebotDialog intercepts pointer events".
{
	const stubborn = await startFakePanel( { bannerMode: 'stubborn' } );

	try {
		const days = await withPanel(
			{
				panelUrl: stubborn.url,
				user: credentials.user,
				password: credentials.password,
				timeout: 15000,
			},
			( page ) => collectDays( page, {} )
		);

		ok( days.length > 0, 'baner bez przycisku zgody nie blokuje logowania' );
	} catch ( error ) {
		failures.push( `baner bez przycisku zgody zablokował logowanie: ${ error.message }` );
	} finally {
		stubborn.server.close();
	}
}

// --- zakres dat ---------------------------------------------------------
// Bez gornej granicy bierzemy wszystko; z granica ucinamy dokladnie tam, gdzie
// trzeba. Sztywne 21 dni gubilo ostatni dzien zamowienia.
{
	const bounded = await withPanel(
		{ panelUrl: url, user: credentials.user, password: credentials.password, timeout: 10000 },
		( page ) => collectDays( page, { from: '2026-09-01', to: '2026-09-03' } )
	);

	same( 1, bounded.length, 'górna granica zakresu odcina późniejsze dni' );
	same( '2026-09-02', bounded[ 0 ].date, 'w zakresie zostaje właściwy dzień' );

	const unbounded = await withPanel(
		{ panelUrl: url, user: credentials.user, password: credentials.password, timeout: 10000 },
		( page ) => collectDays( page, { from: '2026-09-01' } )
	);

	// Bez granicy siegamy takze do nastepnego miesiaca - stad trzy dni, nie dwa.
	same( 3, unbounded.length, 'bez górnej granicy bierzemy wszystkie dni z jadłospisem' );
	same( '2026-09-04', unbounded[ 1 ].date, 'ostatni dzień bieżącego miesiąca nie wypada za burtę' );
	same( '2026-10-01', unbounded[ 2 ].date, 'zakres bez granicy obejmuje następny miesiąc' );
}

// --- panel nie przesuwa is-selected -------------------------------------
// Tak zachowuje sie prawdziwy panel: karta dnia sie zmienia, ale klasa
// is-selected zostaje na starym kafelku. Odczyt musi opierac sie na naglowku
// karty dnia, nie na klasach CSS - inaczej wszystkie dni sa pomijane.
{
	const sticky = await startFakePanel( { stickySelection: true } );

	try {
		const days = await withPanel(
			{
				panelUrl: sticky.url,
				user: credentials.user,
				password: credentials.password,
				timeout: 15000,
			},
			( page ) => collectDays( page, { from: '2026-09-01', maxMonths: 1 } )
		);

		same( 2, days.length, 'dni zbierane mimo nieruchomej klasy is-selected' );
		same( '2026-09-02', days[ 0 ].date, 'pierwszy dzień ma właściwą datę z nagłówka' );
		same( '2026-09-04', days[ 1 ].date, 'drugi dzień ma właściwą datę z nagłówka' );
		same( 1, days[ 1 ].meals.length, 'posiłki należą do właściwego dnia' );
		ok(
			days[ 1 ].meals[ 0 ].description.includes( 'Gulasz' ),
			'treść posiłku pochodzi z otwartego dnia, nie z poprzedniego'
		);
	} catch ( error ) {
		failures.push( `nieruchome is-selected zablokowało odczyt: ${ error.message }` );
	} finally {
		sticky.server.close();
	}
}

// --- prawdziwe klikniecie przechwycone przez nakladke -------------------
// Suwak kalendarza (react-indiana-drag-scroll) przy wcisnieciu przycisku myszy
// ustawia dzieciom pointer-events: none, wiec zwykle klikniecie potrafi nie
// dojsc. Odczyt musi wtedy wyslac zdarzenie click programowo.
{
	const blocked = await startFakePanel( { blockPointer: true } );

	try {
		const days = await withPanel(
			{
				panelUrl: blocked.url,
				user: credentials.user,
				password: credentials.password,
				timeout: 20000,
			},
			( page ) => collectDays( page, { from: '2026-09-01', maxMonths: 1 } )
		);

		same( 2, days.length, 'przechwycone kliknięcie nie blokuje odczytu' );
		same( '2026-09-04', days[ 1 ].date, 'dzień otwarty programowym kliknięciem' );
		ok( days[ 1 ].meals[ 0 ].description.includes( 'Gulasz' ), 'jadłospis pochodzi z właściwego dnia' );
	} catch ( error ) {
		failures.push( `nakładka nad kalendarzem zablokowała odczyt: ${ error.message }` );
	} finally {
		blocked.server.close();
	}
}

// --- panel nie doczytuje posilkow za pierwszym razem --------------------
// Tak zachowywal sie panel przy dalszych dniach jadlospisu: dzien sie otwieral,
// ale lista posilkow zostawala z poprzedniego. Ponowna proba to ratuje.
{
	const flaky = await startFakePanel( { flakyMeals: true } );

	try {
		const days = await withPanel(
			{
				panelUrl: flaky.url,
				user: credentials.user,
				password: credentials.password,
				timeout: 20000,
			},
			( page ) => collectDays( page, { from: '2026-09-01', mealsTimeout: 2500, maxMonths: 1 } )
		);

		same( 2, days.length, 'ponowna próba ratuje dzień, który nie doczytał się za pierwszym razem' );
		ok(
			days[ 1 ].meals[ 0 ].description.includes( 'Gulasz' ),
			'po ponownej próbie jadłospis należy do właściwego dnia'
		);
	} catch ( error ) {
		failures.push( `nieodświeżona lista zablokowała odczyt: ${ error.message }` );
	} finally {
		flaky.server.close();
	}
}

// --- dni poza widokiem suwaka kalendarza --------------------------------
// Kalendarz jest wezszy niz liczba dni. Panel dociaga jadlospis tylko dla
// kafelka widocznego w suwaku, wiec dni z prawej strony wymagaja przewiniecia.
// Klikniecie programowe samo z siebie niczego nie przewija.
{
	const narrow = await startFakePanel( { narrowCalendar: true } );

	try {
		const days = await withPanel(
			{
				panelUrl: narrow.url,
				user: credentials.user,
				password: credentials.password,
				timeout: 20000,
			},
			( page ) => collectDays( page, { from: '2026-09-01', mealsTimeout: 3000, maxMonths: 1 } )
		);

		same( 2, days.length, 'dzień poza widokiem suwaka też jest pobierany' );
		same( '2026-09-04', days[ 1 ].date, 'przewinięty dzień ma właściwą datę' );
		ok( days[ 1 ].meals[ 0 ].description.includes( 'Gulasz' ), 'jadłospis pochodzi z przewiniętego dnia' );
	} catch ( error ) {
		failures.push( `dzień poza widokiem suwaka zablokował odczyt: ${ error.message }` );
	} finally {
		narrow.server.close();
	}
}

// --- jadlospis siegajacy nastepnego miesiaca ----------------------------
// Kalendarz pokazuje jeden miesiac naraz. Pod koniec miesiaca czesc dni
// zamowienia lezy juz w kolejnym - bez przejscia strzalka zostalyby pominiete.
{
	const days = await withPanel(
		{ panelUrl: url, user: credentials.user, password: credentials.password, timeout: 20000 },
		( page ) => collectDays( page, { from: '2026-09-01', details: false } )
	);

	same( 3, days.length, 'dni z następnego miesiąca też są pobierane' );
	same( '2026-10-01', days[ 2 ].date, 'ostatni dzień pochodzi z października' );
	ok(
		days[ 2 ].meals[ 0 ].description.includes( 'Zupa dyniowa' ),
		'jadłospis z następnego miesiąca jest prawdziwy, nie skopiowany'
	);
}

// --- konto bez aktywnego zamowienia -------------------------------------
// Pulpit jest, kalendarza nie ma. To NIE jest bląd logowania - ma się skończyć
// pustą listą i zrozumiałym komunikatem, a nie wyjątkiem.
{
	const empty = await startFakePanel( { noOrder: true } );
	const messages = [];

	try {
		const days = await withPanel(
			{
				panelUrl: empty.url,
				user: credentials.user,
				password: credentials.password,
				timeout: 8000,
				log: ( message ) => messages.push( message ),
			},
			( page ) => collectDays( page, { log: ( message ) => messages.push( message ) } )
		);

		same( 0, days.length, 'brak zamówienia daje pustą listę dni' );
		ok(
			messages.some( ( message ) => /nie pokazał kalendarza|aktywnego zamówienia/i.test( message ) ),
			'komunikat tłumaczy brak kalendarza zamiast milczeć'
		);
		ok(
			messages.some( ( message ) => /diagnose/.test( message ) ),
			'komunikat podpowiada, czym to zdiagnozować'
		);
	} catch ( error ) {
		failures.push( `brak zamówienia wywrócił przebieg zamiast go zakończyć: ${ error.message }` );
	} finally {
		empty.server.close();
	}
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
