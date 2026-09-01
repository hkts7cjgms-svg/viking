/**
 * Test wstrzykiwacza wydarzen do panelu klienta, na fragmencie prawdziwego HTML-a
 * z panel.kuchniavikinga.pl. Uruchomienie: node tests/panel-events.test.mjs
 */
import { createRequire } from 'node:module';

import { panelHtml } from './panel-fixture.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire( import.meta.url );
const ROOT = join( dirname( fileURLToPath( import.meta.url ) ), '..' );

let JSDOM;

try {
	( { JSDOM } = require( 'jsdom' ) );
} catch {
	process.stdout.write( 'POMINIETE - brak jsdom. Zainstaluj: npm install\n' );
	process.exit( 0 );
}

const panelEvents = require( join( ROOT, 'plugin/kuchnia-vikinga-wydarzenia/assets/panel-events.js' ) );

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

// --- normalizacja slugow (musi zgadzac sie z PHP) ------------------------
same( 'sniadanie', panelEvents.normalizeSlug( 'Śniadanie ' ), 'slug: Śniadanie z nadmiarową spacją' );
same( 'ii-sniadanie', panelEvents.normalizeSlug( 'II śniadanie' ), 'slug: II śniadanie' );
same( 'obiad', panelEvents.normalizeSlug( 'Obiad' ), 'slug: Obiad' );
same( 'podwieczorek', panelEvents.normalizeSlug( 'Podwieczorek' ), 'slug: Podwieczorek' );
same( '', panelEvents.normalizeSlug( '   ' ), 'slug: same spacje dają pusty ciąg' );

ok( panelEvents.isValidDate( '2026-09-15' ), 'poprawna data przechodzi' );
ok( ! panelEvents.isValidDate( '15-09-2026' ), 'zły format daty odpada' );

// --- odczyt daty i posilku z DOM ----------------------------------------
{
	const { window } = new JSDOM( panelHtml() );
	const { document } = window;

	same(
		'2026-09-02',
		panelEvents.findSelectedDate( document, panelEvents.DEFAULTS ),
		'data brana z zaznaczonego dnia kalendarza'
	);

	const cards = document.querySelectorAll( panelEvents.DEFAULTS.mealCardSelector );
	same( 3, cards.length, 'selektor łapie wszystkie karty posiłków' );
	same( 'sniadanie', panelEvents.readMealSlug( cards[ 0 ], panelEvents.DEFAULTS ), 'pierwsza karta to śniadanie' );
	same( 'kolacja', panelEvents.readMealSlug( cards[ 2 ], panelEvents.DEFAULTS ), 'trzecia karta to kolacja' );
}

{
	const { window } = new JSDOM( '<!doctype html><html><body><div class="calendar-slider-items"></div></body></html>' );
	same(
		null,
		panelEvents.findSelectedDate( window.document, panelEvents.DEFAULTS ),
		'brak zaznaczonego dnia daje null zamiast wywrotki'
	);
}

// --- budowanie adresu ----------------------------------------------------
{
	const url = new URL( panelEvents.buildUrl( 'https://kuchniavikinga.pl/wp-json/kv/v1/render', '2026-09-15', 'obiad' ) );
	same( '2026-09-15', url.searchParams.get( 'date' ), 'adres niesie datę' );
	same( 'obiad', url.searchParams.get( 'meal' ), 'adres niesie posiłek' );

	const noMeal = new URL( panelEvents.buildUrl( 'https://kuchniavikinga.pl/wp-json/kv/v1/render', '2026-09-15', null ) );
	same( null, noMeal.searchParams.get( 'meal' ), 'bez posiłku parametr nie jest dodawany' );
}

// --- pelny przebieg wstrzykiwania ---------------------------------------
// Skrypt domyka sie na globalnym obiekcie okna, wiec podstawiamy okno jsdom
// jako globalne przed uzyciem create().
{
	const dom = new JSDOM( panelHtml(), { url: 'https://panel.kuchniavikinga.pl/' } );
	const calls = [];

	global.window = dom.window;
	global.document = dom.window.document;
	global.MutationObserver = dom.window.MutationObserver;
	global.fetch = ( url ) => {
		calls.push( String( url ) );
		const meal = new URL( url ).searchParams.get( 'meal' );

		return Promise.resolve( {
			ok: true,
			json: () =>
				Promise.resolve(
					meal === 'obiad'
						? { before: '', after: '<div class="kv-wydarzenia">Dzień Kuchni Polskiej</div>' }
						: { before: '', after: '' }
				),
		} );
	};

	const injector = panelEvents.create( {
		endpoint: 'https://kuchniavikinga.pl/wp-json/kv/v1/render',
		debounceMs: 0,
	} );

	injector.run();
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

	same( 3, calls.length, 'jedno zapytanie na każdy posiłek dnia' );
	ok(
		calls.every( ( url ) => url.includes( 'date=2026-09-02' ) ),
		'wszystkie zapytania dotyczą wybranego dnia'
	);

	const lunch = dom.window.document.querySelector( '#mealCard-4204326 .meal-content' );
	const breakfast = dom.window.document.querySelector( '#mealCard-4204325 .meal-content' );

	ok( lunch.textContent.includes( 'Dzień Kuchni Polskiej' ), 'wydarzenie trafia do opisu obiadu' );
	ok( lunch.textContent.includes( 'Pierogi z ziemniakami' ), 'oryginalny opis obiadu zostaje' );
	ok( ! breakfast.textContent.includes( 'Dzień Kuchni Polskiej' ), 'śniadanie zostaje bez wydarzenia' );

	// Powtorny przebieg nie moze zdublowac tresci ani odpytac API drugi raz.
	injector.run();
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

	same(
		1,
		dom.window.document.querySelectorAll( '#mealCard-4204326 .kv-panel-event' ).length,
		'ponowne uruchomienie nie dubluje wydarzenia'
	);
	same( 3, calls.length, 'powtórny przebieg korzysta z cache, bez nowych zapytań' );

	// Przelaczenie dnia ma wymusic ponowne pobranie i podmiane tresci.
	dom.window.document
		.querySelector( 'div[data-date="2026-09-02"] li.day' )
		.classList.remove( 'is-selected' );
	dom.window.document
		.querySelector( 'div[data-date="2026-09-15"] li.day' )
		.classList.add( 'is-selected' );

	injector.run();
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

	same( 6, calls.length, 'zmiana dnia wywołuje nowe zapytania' );
	ok(
		calls.slice( 3 ).every( ( url ) => url.includes( 'date=2026-09-15' ) ),
		'nowe zapytania dotyczą nowego dnia'
	);
	same(
		1,
		dom.window.document.querySelectorAll( '#mealCard-4204326 .kv-panel-event' ).length,
		'po zmianie dnia stara treść jest zastąpiona, nie doklejona'
	);

	delete global.window;
	delete global.document;
	delete global.MutationObserver;
	delete global.fetch;
}

// --- zbieranie dnia i zapis do Kalendarza Google -------------------------
{
	const dom = new JSDOM( panelHtml(), { url: 'https://panel.kuchniavikinga.pl/' } );
	const day = panelEvents.collectDay( dom.window.document, panelEvents.DEFAULTS );

	same( '2026-09-02', day.date, 'zebrany dzień ma datę z kalendarza' );
	same( 3, day.meals.length, 'zebrane są wszystkie posiłki dnia' );
	same( 'sniadanie', day.meals[ 0 ].slug, 'pierwszy posiłek to śniadanie' );
	same( 'Śniadanie', day.meals[ 0 ].name, 'nazwa posiłku bez nadmiarowych spacji' );
	ok(
		day.meals[ 1 ].description.startsWith( 'Pierogi z ziemniakami' ),
		'opis posiłku trafia do zebranych danych'
	);
	same( '479kcal · B: 46.7g', day.meals[ 0 ].nutrition.join( ' · ' ), 'wartości odżywcze są zbierane' );

	const details = panelEvents.formatDayDetails( day );
	ok( details.includes( 'ŚNIADANIE' ), 'opis wpisu zawiera nagłówek posiłku' );
	ok( details.includes( 'Tacos z szarpaną wieprzowiną' ), 'opis wpisu zawiera kolację' );
	ok( details.includes( '479kcal' ), 'opis wpisu zawiera kalorie' );

	const url = new URL( panelEvents.buildGoogleCalendarUrl( day, 'Jadłospis' ) );
	same( 'calendar.google.com', url.hostname, 'link prowadzi do Kalendarza Google' );
	same( 'TEMPLATE', url.searchParams.get( 'action' ), 'link używa formularza TEMPLATE' );
	same( '20260902/20260903', url.searchParams.get( 'dates' ), 'wpis całodniowy, koniec wyłączny' );
	ok( url.searchParams.get( 'text' ).includes( '2026-09-02' ), 'tytuł wpisu niesie datę' );
	ok( url.searchParams.get( 'details' ).includes( 'Pierogi' ), 'szczegóły wpisu niosą jadłospis' );
}

// Wydarzenia doklejone przez nas nie moga wyciec do opisu wpisu w kalendarzu.
{
	const dom = new JSDOM( panelHtml(), { url: 'https://panel.kuchniavikinga.pl/' } );
	const lunch = dom.window.document.querySelector( '#mealCard-4204326 .meal-content' );
	const injected = dom.window.document.createElement( 'div' );

	injected.className = 'kv-panel-event';
	injected.textContent = 'Dzień Kuchni Polskiej';
	lunch.appendChild( injected );

	const day = panelEvents.collectDay( dom.window.document, panelEvents.DEFAULTS );

	ok( day.meals[ 1 ].description.includes( 'Pierogi' ), 'oryginalny opis nadal jest zbierany' );
	ok(
		! day.meals[ 1 ].description.includes( 'Dzień Kuchni Polskiej' ),
		'nasza wstawka nie trafia do danych dnia'
	);
}

// --- przycisk zapisu w naglowku karty dnia -------------------------------
{
	const dom = new JSDOM( panelHtml(), { url: 'https://panel.kuchniavikinga.pl/' } );

	global.window = dom.window;
	global.document = dom.window.document;
	global.MutationObserver = dom.window.MutationObserver;
	global.fetch = () => Promise.resolve( { ok: true, json: () => Promise.resolve( { before: '', after: '' } ) } );

	const injector = panelEvents.create( { debounceMs: 0 } );

	injector.run();
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

	const button = dom.window.document.querySelector( '#dayDetailsCard .card-header .kv-panel-save-day' );

	ok( Boolean( button ), 'przycisk zapisu pojawia się w nagłówku karty dnia' );
	ok( button.href.includes( 'calendar.google.com' ), 'przycisk prowadzi do Kalendarza Google' );
	ok( button.href.includes( '20260902' ), 'przycisk niesie datę otwartego dnia' );
	same( '_blank', button.target, 'przycisk otwiera się w nowej karcie' );

	// Zmiana dnia ma przeliczyc adres, a nie dolozyc drugi przycisk.
	dom.window.document.querySelector( 'div[data-date="2026-09-02"] li.day' ).classList.remove( 'is-selected' );
	dom.window.document.querySelector( 'div[data-date="2026-09-15"] li.day' ).classList.add( 'is-selected' );

	injector.run();
	await new Promise( ( resolve ) => setTimeout( resolve, 10 ) );

	same(
		1,
		dom.window.document.querySelectorAll( '.kv-panel-save-day' ).length,
		'po zmianie dnia nadal jest jeden przycisk'
	);
	ok(
		dom.window.document.querySelector( '.kv-panel-save-day' ).href.includes( '20260915' ),
		'po zmianie dnia adres przycisku jest przeliczony'
	);

	delete global.window;
	delete global.document;
	delete global.MutationObserver;
	delete global.fetch;
}

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
