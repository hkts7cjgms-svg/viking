/**
 * Test planowania i wykonania synchronizacji z Kalendarzem Google.
 * Bez sieci i bez konta Google. Uruchomienie: node tests/calendar-sync.test.mjs
 */
import { buildEvent, planSync, applySync, formatDescription, addDays } from '../agent/calendar-sync.mjs';
import { SOURCE_TAG } from '../agent/google-calendar.mjs';

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

function day( date, meals ) {
	return {
		date,
		summary: '3 posiłki + 0 dodatków',
		meals: meals.map( ( [ name, description, kcal ] ) => ( {
			slug: name.toLowerCase(),
			name,
			description,
			nutrition: [ `${ kcal }kcal` ],
			details: {},
		} ) ),
	};
}

const wednesday = day( '2026-09-02', [
	[ 'Śniadanie', 'Kanapka z chlebem wiejskim', 479 ],
	[ 'Obiad', 'Pierogi z ziemniakami', 589 ],
] );

/** Wpis w kalendarzu odpowiadajacy danemu dniowi - jak po wczesniejszej synchronizacji. */
function existingFor( source, id = 'evt-1' ) {
	const event = buildEvent( source, { title: 'Jadłospis' } );

	return { id, ...event };
}

// --- budowa wpisu --------------------------------------------------------
{
	const event = buildEvent( wednesday, { title: 'Jadłospis' } );

	same( 'Jadłospis · 2026-09-02', event.summary, 'tytuł wpisu zawiera datę' );
	same( '2026-09-02', event.start.date, 'wpis całodniowy zaczyna się w tym dniu' );
	same( '2026-09-03', event.end.date, 'koniec zakresu jest wyłączny' );
	same( SOURCE_TAG, event.extendedProperties.private.kvSource, 'wpis oznaczony jako nasz' );
	same( '2026-09-02', event.extendedProperties.private.kvDay, 'wpis niesie dzień jadłospisu' );
	ok( event.description.includes( 'ŚNIADANIE' ), 'opis zawiera nagłówek posiłku' );
	ok( event.description.includes( 'Pierogi z ziemniakami' ), 'opis zawiera treść posiłku' );
	ok( event.description.includes( '479kcal' ), 'opis zawiera kalorie' );
	ok( event.description.includes( '3 posiłki' ), 'opis zawiera podsumowanie dnia' );
}

same( '2026-10-01', addDays( '2026-09-30', 1 ), 'dodawanie dni przechodzi przez koniec miesiąca' );
same( '2027-01-01', addDays( '2026-12-31', 1 ), 'dodawanie dni przechodzi przez koniec roku' );

// Szczegoly z bocznego panelu, gdy juz je poznamy, maja trafiac do opisu.
{
	const withDetails = {
		date: '2026-09-02',
		meals: [
			{
				name: 'Obiad',
				description: 'Pierogi',
				nutrition: [],
				details: { Składniki: 'mąka, ziemniaki, twaróg', Alergeny: 'gluten, mleko' },
			},
		],
	};

	const description = formatDescription( withDetails );

	ok( description.includes( 'Składniki: mąka, ziemniaki, twaróg' ), 'składniki trafiają do opisu' );
	ok( description.includes( 'Alergeny: gluten, mleko' ), 'alergeny trafiają do opisu' );
}

// --- plan: pusty kalendarz ----------------------------------------------
{
	const plan = planSync( [ wednesday ], [], { title: 'Jadłospis' } );

	same( 1, plan.insert.length, 'nowy dzień jest do dodania' );
	same( 0, plan.patch.length, 'nie ma czego poprawiać' );
	same( 0, plan.remove.length, 'nie ma czego usuwać' );
}

// --- plan: ten sam jadlospis drugi raz ----------------------------------
{
	const plan = planSync( [ wednesday ], [ existingFor( wednesday ) ], { title: 'Jadłospis' } );

	same( 0, plan.insert.length, 'powtórna synchronizacja nic nie dodaje' );
	same( 0, plan.patch.length, 'niezmieniony dzień nie jest nadpisywany' );
	same( 1, plan.unchanged.length, 'niezmieniony dzień jest rozpoznany' );
}

// --- plan: zmieniony jadlospis ------------------------------------------
{
	const changed = day( '2026-09-02', [ [ 'Śniadanie', 'Owsianka z owocami', 420 ] ] );
	const plan = planSync( [ changed ], [ existingFor( wednesday ) ], { title: 'Jadłospis' } );

	same( 1, plan.patch.length, 'zmiana jadłospisu daje poprawkę wpisu' );
	same( 'evt-1', plan.patch[ 0 ].id, 'poprawka trafia w istniejący wpis' );
	ok( plan.patch[ 0 ].event.description.includes( 'Owsianka' ), 'poprawka niesie nową treść' );
	same( 0, plan.insert.length, 'zmiana nie tworzy drugiego wpisu na ten sam dzień' );
}

// --- plan: dzien zniknal z jadlospisu -----------------------------------
{
	const plan = planSync( [], [ existingFor( wednesday ) ], { title: 'Jadłospis' } );

	same( 1, plan.remove.length, 'wpis na dzień spoza jadłospisu jest usuwany' );
	same( 'evt-1', plan.remove[ 0 ].id, 'usuwany jest właściwy wpis' );
}

// --- plan: duplikaty na ten sam dzien -----------------------------------
{
	const plan = planSync(
		[ wednesday ],
		[ existingFor( wednesday, 'evt-1' ), existingFor( wednesday, 'evt-2' ) ],
		{ title: 'Jadłospis' }
	);

	same( 1, plan.remove.length, 'duplikat na ten sam dzień jest sprzątany' );
	same( 'evt-2', plan.remove[ 0 ].id, 'zostaje pierwszy wpis, duplikat znika' );
}

// --- plan: cudze wpisy sa nietykalne ------------------------------------
{
	const foreign = { id: 'urodziny', summary: 'Urodziny Ani', extendedProperties: { private: {} } };
	const plan = planSync( [ wednesday ], [ foreign ], { title: 'Jadłospis' } );

	same( 0, plan.remove.length, 'wpis bez naszego znacznika nie jest ruszany' );
	same( 1, plan.insert.length, 'nasz dzień i tak zostaje dodany' );
}

// --- plan: dzien bez posilkow pomijany ----------------------------------
{
	const plan = planSync( [ { date: '2026-09-05', meals: [] } ], [], { title: 'Jadłospis' } );

	same( 0, plan.insert.length, 'dzień bez posiłków nie trafia do kalendarza' );
}

// --- wykonanie planu -----------------------------------------------------
{
	const calls = [];
	const client = {
		insert: ( event ) => {
			calls.push( [ 'insert', event.extendedProperties.private.kvDay ] );

			return Promise.resolve( {} );
		},
		patch: ( id ) => {
			calls.push( [ 'patch', id ] );

			return Promise.resolve( {} );
		},
		remove: ( id ) => {
			calls.push( [ 'remove', id ] );

			return Promise.resolve( null );
		},
	};

	const thursday = day( '2026-09-03', [ [ 'Obiad', 'Gulasz', 600 ] ] );
	const plan = planSync(
		[ wednesday, thursday ],
		[ existingFor( day( '2026-09-02', [ [ 'Śniadanie', 'Coś innego', 100 ] ] ), 'evt-1' ), existingFor( day( '2026-09-09', [ [ 'Obiad', 'Stare', 1 ] ] ), 'evt-old' ) ],
		{ title: 'Jadłospis' }
	);

	const report = await applySync( client, plan );

	same( 1, report.inserted, 'raport liczy dodane wpisy' );
	same( 1, report.patched, 'raport liczy poprawione wpisy' );
	same( 1, report.removed, 'raport liczy usunięte wpisy' );
	same( 3, calls.length, 'wykonano dokładnie trzy operacje' );
	same( 'remove', calls[ 2 ][ 0 ], 'usuwanie idzie na końcu' );

	// Próba na sucho nie moze dotknac kalendarza.
	const dryCalls = [];
	const dryClient = {
		insert: () => dryCalls.push( 'insert' ),
		patch: () => dryCalls.push( 'patch' ),
		remove: () => dryCalls.push( 'remove' ),
	};

	const dryReport = await applySync( dryClient, plan, { dryRun: true } );

	same( 0, dryCalls.length, 'próba na sucho nie woła API' );
	same( 1, dryReport.inserted, 'próba na sucho i tak raportuje, co by zrobiła' );
}

if ( failures.length === 0 ) {
	process.stdout.write( `OK - ${ passed } asercji przeszlo\n` );
} else {
	process.stdout.write( `FAIL - ${ passed } przeszlo, ${ failures.length } nie przeszlo\n` );
	failures.forEach( ( failure ) => process.stdout.write( `  - ${ failure }\n` ) );
	process.exitCode = 1;
}
