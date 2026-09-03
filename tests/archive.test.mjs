/**
 * Test archiwum jadlospisu. Uruchomienie: node tests/archive.test.mjs
 */
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseNutrition, toRows, mergeRows, toCsv, parseCsv, saveArchive, COLUMNS } from '../agent/archive.mjs';

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

// --- rozbijanie wartosci odzywczych -------------------------------------
{
	const n = parseNutrition( [ '479kcal', 'B: 46.7g', 'W: 27.7g', 'T: 20.2g' ] );

	same( '479', n.kcal, 'kcal odczytane' );
	same( '46.7', n.protein, 'białko odczytane' );
	same( '27.7', n.carbs, 'węglowodany odczytane' );
	same( '20.2', n.fat, 'tłuszcz odczytany' );
}

{
	const n = parseNutrition( [ '1601,0kcal', 'B: 90,4g' ] );

	same( '1601.0', n.kcal, 'przecinek dziesiętny zamieniony na kropkę' );
	same( '90.4', n.protein, 'przecinek w makro też zamieniony' );
}

{
	const n = parseNutrition( [ 'coś dziwnego', '' ] );

	same( '', n.kcal, 'nierozpoznana wartość nie psuje wyniku' );
}

same( '', parseNutrition( undefined ).kcal, 'brak danych odżywczych nie wywraca funkcji' );

// --- wiersze -------------------------------------------------------------
const day = ( date, meals ) => ( {
	date,
	meals: meals.map( ( [ slug, name, description, nutrition ] ) => ( {
		slug,
		name,
		description,
		nutrition,
		details: {},
	} ) ),
} );

const wednesday = day( '2026-09-02', [
	[ 'sniadanie', 'Śniadanie', 'Kanapka z chlebem, serem i pomidorem', [ '479kcal', 'B: 46.7g' ] ],
	[ 'obiad', 'Obiad', 'Pierogi z ziemniakami', [ '589kcal' ] ],
] );

{
	const rows = toRows( [ wednesday ], '2026-09-01T08:00:00Z' );

	same( 2, rows.length, 'każdy posiłek to osobny wiersz' );
	same( '2026-09-02', rows[ 0 ].data, 'wiersz niesie datę' );
	same( 'sniadanie', rows[ 0 ].posilek, 'wiersz niesie slug posiłku' );
	same( '', rows[ 0 ].dieta, 'panel klienta ma jedną dietę, więc kolumna zostaje pusta' );
	same( '479', rows[ 0 ].kcal, 'wiersz niesie kalorie' );
	same( '2026-09-01T08:00:00Z', rows[ 0 ].zaktualizowano, 'wiersz niesie znacznik czasu' );
}

// --- CSV w obie strony ---------------------------------------------------
{
	const rows = toRows( [ wednesday ], '2026-09-01T08:00:00Z' );
	const csv = toCsv( rows );

	same( COLUMNS.join( ',' ), csv.split( '\n' )[ 0 ], 'pierwszy wiersz to nagłówek' );
	ok( csv.includes( '"Kanapka z chlebem, serem i pomidorem"' ), 'opis z przecinkiem jest w cudzysłowach' );

	const parsed = parseCsv( csv );

	same( 2, parsed.length, 'odczyt daje tyle samo wierszy' );
	same( 'Kanapka z chlebem, serem i pomidorem', parsed[ 0 ].opis, 'przecinek w opisie przetrwał zapis i odczyt' );
}

{
	// Cudzyslowy i nowe linie w opisie to najczestsze zrodlo rozjazdu CSV.
	const tricky = [
		{
			...toRows( [ day( '2026-09-03', [ [ 'obiad', 'Obiad', 'Danie "specjalne", z\nnową linią', [] ] ] ) ] )[ 0 ],
			zaktualizowano: '2026-09-01T08:00:00Z',
		},
	];

	const parsed = parseCsv( toCsv( tricky ) );

	same( 1, parsed.length, 'wiersz z nową linią nadal jest jednym wierszem' );
	same( 'Danie "specjalne", z\nnową linią', parsed[ 0 ].opis, 'cudzysłowy i nowa linia przetrwały' );
}

same( 0, parseCsv( '' ).length, 'pusty plik daje pustą listę' );
same( 0, parseCsv( `${ COLUMNS.join( ',' ) }\n` ).length, 'sam nagłówek daje pustą listę' );

// --- laczenie: nic nie znika ---------------------------------------------
{
	const stare = toRows( [ day( '2026-08-01', [ [ 'obiad', 'Obiad', 'Rosół', [] ] ] ) ], '2026-08-01T08:00:00Z' );
	const nowe = toRows( [ wednesday ], '2026-09-01T08:00:00Z' );
	const merged = mergeRows( stare, nowe );

	same( 3, merged.length, 'stary dzień zostaje obok nowych' );
	same( '2026-08-01', merged[ 0 ].data, 'wiersze są posortowane po dacie' );
	ok(
		merged.some( ( row ) => 'Rosół' === row.opis ),
		'dzień spoza nowej porcji nie znika z archiwum'
	);
}

{
	// Ta sama tresc drugi raz - znacznik czasu ma zostac stary.
	const pierwsze = toRows( [ wednesday ], '2026-09-01T08:00:00Z' );
	const drugie = toRows( [ wednesday ], '2026-09-02T08:00:00Z' );
	const merged = mergeRows( pierwsze, drugie );

	same( 2, merged.length, 'powtórka nie mnoży wierszy' );
	same( '2026-09-01T08:00:00Z', merged[ 0 ].zaktualizowano, 'niezmieniony wiersz zachowuje stary znacznik' );
}

{
	const pierwsze = toRows( [ wednesday ], '2026-09-01T08:00:00Z' );
	const zmienione = toRows(
		[ day( '2026-09-02', [ [ 'sniadanie', 'Śniadanie', 'Owsianka z owocami', [ '420kcal' ] ] ] ) ],
		'2026-09-02T08:00:00Z'
	);
	const merged = mergeRows( pierwsze, zmienione );

	same( 2, merged.length, 'zmiana nie dodaje trzeciego wiersza' );
	same( 'Owsianka z owocami', merged[ 1 ].opis, 'zmieniony posiłek jest nadpisany' );
	same( '2026-09-02T08:00:00Z', merged[ 1 ].zaktualizowano, 'zmieniony wiersz dostaje nowy znacznik' );
	same( 'Pierogi z ziemniakami', merged[ 0 ].opis, 'pozostałe posiłki dnia zostają nietknięte' );
}

// --- zapis na dysk -------------------------------------------------------
{
	const dir = mkdtempSync( join( tmpdir(), 'kv-archive-' ) );
	const path = join( dir, 'jadlospis.csv' );

	const first = saveArchive( path, [ wednesday ], { now: '2026-09-01T08:00:00Z' } );

	same( 0, first.before, 'pierwszy zapis startuje z pustego' );
	same( 2, first.after, 'pierwszy zapis zapisuje dwa wiersze' );

	const second = saveArchive(
		path,
		[ day( '2026-09-03', [ [ 'obiad', 'Obiad', 'Gulasz', [] ] ] ) ],
		{ now: '2026-09-02T08:00:00Z' }
	);

	same( 2, second.before, 'drugi zapis widzi poprzednie wiersze' );
	same( 3, second.after, 'drugi zapis dokłada nowy dzień' );
	same( 1, second.added, 'raport liczy dołożone wiersze' );

	const onDisk = parseCsv( readFileSync( path, 'utf8' ) );

	same( 3, onDisk.length, 'plik na dysku ma wszystkie wiersze' );
	ok(
		onDisk.some( ( row ) => '2026-09-02' === row.data ) && onDisk.some( ( row ) => '2026-09-03' === row.data ),
		'oba dni są w pliku'
	);

	// Plik dopisany recznie nie moze zostac zgubiony.
	writeFileSync(
		path,
		`${ readFileSync( path, 'utf8' ) }2026-07-01,,obiad,Obiad,Notatka ręczna,,,,,,,2026-07-01T00:00:00Z\n`,
		'utf8'
	);

	const third = saveArchive( path, [ wednesday ], { now: '2026-09-03T08:00:00Z' } );

	same( 4, third.after, 'ręcznie dopisany wiersz przetrwał kolejną synchronizację' );

	rmSync( dir, { recursive: true, force: true } );
}

// --- wiele diet w jednym archiwum ---------------------------------------
{
	const smart = { ...day( '2026-09-02', [ [ 'obiad', 'Obiad', 'Pierogi', [] ] ] ), diet: 'Smart 1500' };
	const sport = { ...day( '2026-09-02', [ [ 'obiad', 'Obiad', 'Kurczak z ryżem', [] ] ] ), diet: 'Sport 2500' };
	const rows = toRows( [ smart, sport ], '2026-09-01T08:00:00Z' );

	same( 2, rows.length, 'ten sam obiad w dwóch dietach to dwa wiersze' );
	same( 'Smart 1500', rows[ 0 ].dieta, 'wiersz niesie nazwę diety' );

	const merged = mergeRows( rows, toRows( [ smart ], '2026-09-03T08:00:00Z' ) );

	same( 2, merged.length, 'ponowny odczyt jednej diety nie kasuje drugiej' );
	same(
		'Kurczak z ryżem',
		merged.find( ( row ) => 'Sport 2500' === row.dieta ).opis,
		'druga dieta zostaje nietknięta'
	);
	same(
		'2026-09-01T08:00:00Z',
		merged.find( ( row ) => 'Smart 1500' === row.dieta ).zaktualizowano,
		'niezmieniony posiłek zachowuje stary znacznik czasu'
	);
}

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
