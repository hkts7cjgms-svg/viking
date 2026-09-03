/**
 * Test odczytu publicznego jadlospisu. Uruchomienie: node tests/public-menu.test.mjs
 *
 * Zamiast prawdziwej strony stawiamy atrape WordPressa na localhoscie - test
 * nie wychodzi w internet i dziala tak samo bez sieci.
 */

import { createServer } from 'node:http';

import {
	readPublicMenu,
	toDay,
	toDays,
	toIsoDate,
	slugify,
	number,
	text,
	pick,
	PublicMenuError,
} from '../agent/public-menu.mjs';
import { toRows } from '../agent/archive.mjs';

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

// --- drobne narzedzia ----------------------------------------------------
{
	same( 'sniadanie', slugify( 'Śniadanie' ), 'polskie znaki w slugu jak w panelu' );
	same( 'ii-sniadanie', slugify( 'II Śniadanie' ), 'spacje zamieniają się w myślnik' );
	same( '479', number( '479 kcal' ), 'liczba wyłuskana z jednostki' );
	same( '46.7', number( '46,7 g' ), 'przecinek dziesiętny zamieniony na kropkę' );
	same( '1601', number( '1 601 kcal' ), 'spacja w tysiącach nie psuje liczby' );
	same( 'Pierogi & ser', text( '<p>Pierogi &amp; ser</p>' ), 'znaczniki i encje wycięte' );
	same( 'Smart', text( { rendered: 'Smart' } ), 'pole {rendered} czytane jak tekst' );
	same( 'obiad', pick( { 'Rodzaj_Posiłku': 'obiad' }, [ 'typ', 'rodzaj' ] ), 'pole rozpoznane mimo ozdobników w nazwie' );
	same( undefined, pick( { opis: '' }, [ 'opis' ] ), 'puste pole traktujemy jak brak' );
}

// --- daty ----------------------------------------------------------------
{
	same( '2026-09-04', toIsoDate( '2026-09-04T00:00:00' ), 'data ISO' );
	same( '2026-09-04', toIsoDate( '04.09.2026' ), 'data z kropkami' );
	same( '2026-09-04', toIsoDate( '20260904' ), 'data w zapisie ACF' );
	same( '2026-09-04', toIsoDate( '4 września 2026' ), 'data słowna z rokiem' );
	same( '2026-09-04', toIsoDate( 'Smart 1500 kcal — 4 września', '2026-09-01' ), 'data słowna bez roku' );
	same( '2027-01-05', toIsoDate( '5 stycznia', '2026-09-01' ), 'styczeń po wrześniu to następny rok' );
	same( '', toIsoDate( 'bez daty' ), 'tekst bez daty nie udaje dnia' );
}

// --- wpis WordPressa na dzien -------------------------------------------
{
	const day = toDay( {
		title: { rendered: 'Smart 1500 kcal — 4 września' },
		acf: {
			data: '2026-09-04',
			dieta: 'Smart 1500 kcal',
			posilki: [
				{
					rodzaj: 'Śniadanie',
					nazwa: 'Kanapka',
					opis: 'Kanapka z chlebem wiejskim i serem',
					kcal: '479 kcal',
					bialko: '46,7 g',
					weglowodany: '27,7 g',
					tluszcz: '20,2 g',
					skladniki: 'chleb, ser, pomidor',
					alergeny: 'gluten, mleko',
				},
			],
		},
	} );

	same( '2026-09-04', day.date, 'data odczytana z pola' );
	same( 'Smart 1500 kcal', day.diet, 'nazwa diety odczytana z pola' );
	same( 1, day.meals.length, 'posiłek odczytany' );
	same( 'sniadanie', day.meals[ 0 ].slug, 'slug posiłku jak w panelu' );
	same( 'Śniadanie', day.meals[ 0 ].name, 'w nazwie stoi pora posiłku' );
	same( 'Kanapka z chlebem wiejskim i serem', day.meals[ 0 ].description, 'w opisie stoi danie' );
	same( '479kcal', day.meals[ 0 ].nutrition[ 0 ], 'kalorie w zapisie panelu' );
	same( 'B: 46.7g', day.meals[ 0 ].nutrition[ 1 ], 'białko w zapisie panelu' );
	same( 'chleb, ser, pomidor', day.meals[ 0 ].details[ 'Składniki' ], 'składniki trafiają do szczegółów' );
	same( 'gluten, mleko', day.meals[ 0 ].details[ 'Alergeny' ], 'alergeny trafiają do szczegółów' );

	// Te same dane muszą wejść do archiwum bez żadnej przeróbki.
	const row = toRows( [ day ], '2026-09-01T08:00:00Z' )[ 0 ];

	same( 'Smart 1500 kcal', row.dieta, 'dieta trafia do wiersza archiwum' );
	same( '46.7', row.bialko_g, 'makroskładniki rozbite na kolumny' );
	same( 'gluten, mleko', row.alergeny, 'alergeny w osobnej kolumnie' );
}

// --- plaski zapis: osobne pole na kazdy posilek --------------------------
{
	const day = toDay( {
		title: { rendered: 'Wegetariańska' },
		acf: { data: '2026-09-05', sniadanie: 'Owsianka z owocami', obiad: 'Leczo', kolacja: '' },
	} );

	same( 2, day.meals.length, 'puste pole nie tworzy posiłku' );
	same( 'sniadanie', day.meals[ 0 ].slug, 'nazwa pola stała się posiłkiem' );
	same( 'Owsianka z owocami', day.meals[ 0 ].description, 'treść pola stała się opisem dania' );
	same( 'Wegetariańska', day.diet, 'nazwa diety wzięta z tytułu wpisu' );
}

// --- dzien bez menu i dzien bez daty ------------------------------------
{
	same( null, toDay( { acf: { data: '2026-09-06', posilki: [] } } ), 'dzień bez posiłków pomijamy' );
	same( null, toDay( { acf: { dieta: 'Smart', posilki: [ { nazwa: 'Zupa' } ] } } ), 'wpis bez daty pomijamy' );
}

// --- laczenie wpisow w dni ----------------------------------------------
{
	const days = toDays( [
		{ acf: { data: '2026-09-04', dieta: 'Smart', posilki: [ { rodzaj: 'Obiad', opis: 'Pierogi' } ] } },
		{ acf: { data: '2026-09-04', dieta: 'Smart', posilki: [ { rodzaj: 'Kolacja', opis: 'Sałatka' } ] } },
		{ acf: { data: '2026-09-04', dieta: 'Sport', posilki: [ { rodzaj: 'Obiad', opis: 'Kurczak' } ] } },
		{ acf: { data: '2026-09-03', dieta: 'Smart', posilki: [ { rodzaj: 'Obiad', opis: 'Rosół' } ] } },
	] );

	same( 3, days.length, 'ten sam dzień tej samej diety to jeden wpis' );
	same( '2026-09-03', days[ 0 ].date, 'dni idą po dacie' );
	same( 2, days[ 1 ].meals.length, 'posiłki tego samego dnia zebrane razem' );
	same( 'Smart', days[ 1 ].diet, 'diety tego samego dnia po nazwie' );
	same( 'Kurczak', days[ 2 ].meals[ 0 ].description, 'druga dieta osobno' );
}

// --- cala droga przez atrape WordPressa ---------------------------------
const wp = createServer( ( request, response ) => {
	const url = new URL( request.url, 'http://localhost' );
	const json = ( body ) => {
		response.writeHead( 200, { 'Content-Type': 'application/json' } );
		response.end( JSON.stringify( body ) );
	};

	if ( '/wp-json/wp/v2/types' === url.pathname ) {
		return json( {
			post: { name: 'Wpisy', rest_base: 'posts' },
			page: { name: 'Strony', rest_base: 'pages' },
			kv_menu: { name: 'Jadłospisy', rest_base: 'jadlospisy' },
		} );
	}

	if ( '/wp-json/wp/v2/jadlospisy' === url.pathname ) {
		// Druga strona pusta - tak WordPress konczy stronicowanie.
		if ( '1' !== url.searchParams.get( 'page' ) ) {
			response.writeHead( 400, { 'Content-Type': 'application/json' } );

			return response.end( JSON.stringify( { code: 'rest_post_invalid_page_number' } ) );
		}

		return json( [
			{
				id: 1,
				title: { rendered: 'Smart 1500 kcal — 4 września' },
				acf: {
					data: '2026-09-04',
					dieta: 'Smart 1500 kcal',
					posilki: [ { rodzaj: 'Śniadanie', opis: 'Kanapka', kcal: '479 kcal' } ],
				},
			},
			{
				id: 2,
				title: { rendered: 'Sport 2500 kcal — 4 września' },
				acf: {
					data: '2026-09-04',
					dieta: 'Sport 2500 kcal',
					posilki: [ { rodzaj: 'Obiad', opis: 'Kurczak z ryżem', kcal: '812 kcal' } ],
				},
			},
			{ id: 3, title: { rendered: 'Zapowiedź' }, acf: {} },
		] );
	}

	response.writeHead( 404, { 'Content-Type': 'application/json' } );
	response.end( '{}' );
} );

await new Promise( ( done ) => wp.listen( 0, '127.0.0.1', done ) );

const site = `http://127.0.0.1:${ wp.address().port }`;

{
	const days = await readPublicMenu( { site, perPage: 100 } );

	same( 2, days.length, 'dwie diety tego samego dnia to dwa wpisy' );
	same( 'Smart 1500 kcal', days[ 0 ].diet, 'pierwsza dieta odczytana' );
	same( 'Sport 2500 kcal', days[ 1 ].diet, 'druga dieta odczytana' );
	same( '2026-09-04', days[ 0 ].date, 'data odczytana' );
	same( 'Kanapka', days[ 0 ].meals[ 0 ].description, 'danie odczytane' );

	const rows = toRows( days, '2026-09-01T08:00:00Z' );

	same( 2, rows.length, 'z dni robią się wiersze arkusza' );
	same( '812', rows[ 1 ].kcal, 'kalorie drugiej diety w swoim wierszu' );
}

// --- strona bez REST API -------------------------------------------------
{
	const closed = createServer( ( request, response ) => {
		response.writeHead( 404, { 'Content-Type': 'application/json' } );
		response.end( '{}' );
	} );

	await new Promise( ( done ) => closed.listen( 0, '127.0.0.1', done ) );

	let error = null;

	try {
		await readPublicMenu( { site: `http://127.0.0.1:${ closed.address().port }` } );
	} catch ( caught ) {
		error = caught;
	}

	ok( error instanceof PublicMenuError, 'brak REST API to zrozumiały błąd, nie wysypka' );
	ok( error.message.includes( 'discover' ), 'błąd mówi, co zrobić dalej' );

	closed.close();
}

// --- REST API bez typu z jadlospisem ------------------------------------
{
	const bare = createServer( ( request, response ) => {
		response.writeHead( 200, { 'Content-Type': 'application/json' } );
		response.end( JSON.stringify( { post: { name: 'Wpisy', rest_base: 'posts' } } ) );
	} );

	await new Promise( ( done ) => bare.listen( 0, '127.0.0.1', done ) );

	let message = '';

	try {
		await readPublicMenu( { site: `http://127.0.0.1:${ bare.address().port }` } );
	} catch ( error ) {
		message = error.message;
	}

	ok( message.includes( 'jadłospisem' ), 'brak typu z jadłospisem nazwany po imieniu' );

	bare.close();
}

wp.close();

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
