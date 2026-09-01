/**
 * Zapis jadlospisu do Kalendarza Apple (Calendar.app, wiec takze iCloud).
 *
 * Uruchamiany przez: osascript -l JavaScript apple-calendar.jxa.js dane.json
 *
 * Plik wejsciowy zawiera gotowe wpisy - tytul, opis i skrot tresci liczy Node,
 * tutaj zostaje samo szukanie, zakladanie i poprawianie wydarzen.
 *
 * NIC NIE JEST USUWANE. Gdy dzien zniknie z panelu, wpis w kalendarzu zostaje.
 */

ObjC.import( 'Foundation' );

function readJson( path ) {
	var content = $.NSString.stringWithContentsOfFileEncodingError( path, $.NSUTF8StringEncoding, null );

	if ( ! content ) {
		throw new Error( 'Nie mogę odczytać pliku wejściowego: ' + path );
	}

	return JSON.parse( ObjC.unwrap( content ) );
}

/** Dzien jako data lokalna o polnocy - wydarzenia calodniowe tego wymagaja. */
function midnight( isoDate ) {
	var parts = String( isoDate ).split( '-' );

	return new Date( Number( parts[ 0 ] ), Number( parts[ 1 ] ) - 1, Number( parts[ 2 ] ), 0, 0, 0 );
}

function nextDay( isoDate ) {
	var date = midnight( isoDate );

	date.setDate( date.getDate() + 1 );

	return date;
}

/** Znacznik doklejany na koncu opisu - po nim rozpoznajemy swoje wpisy. */
function marker( date, hash ) {
	return '[kv-sync ' + date + ' ' + hash + ']';
}

function markerPattern( date ) {
	return '[kv-sync ' + date + ' ';
}

function run( argv ) {
	var input = readJson( argv[ 0 ] );
	var report = { created: 0, updated: 0, unchanged: 0, skipped: 0, errors: [] };

	var app = Application( 'Calendar' );

	app.includeStandardAdditions = true;

	var calendar = null;
	var calendars = app.calendars.whose( { name: input.calendarName } );

	if ( calendars.length > 0 ) {
		calendar = calendars[ 0 ];
	}

	if ( ! calendar ) {
		return JSON.stringify( {
			created: 0,
			updated: 0,
			unchanged: 0,
			skipped: 0,
			errors: [
				'Nie znalazłem kalendarza "' +
					input.calendarName +
					'". Załóż go w Kalendarzu (Plik → Nowy kalendarz) albo podaj inną nazwę.',
			],
		} );
	}

	// Kalendarz jest dedykowany tej synchronizacji, wiec czytamy go w calosci -
	// to pewniejsze niz filtrowanie po datach przez zapytania Calendar.app.
	var existing = calendar.events();
	var byDate = {};

	for ( var i = 0; i < existing.length; i++ ) {
		var description = '';

		try {
			description = existing[ i ].description() || '';
		} catch ( error ) {
			continue;
		}

		var found = description.indexOf( '[kv-sync ' );

		if ( -1 === found ) {
			continue;
		}

		var tail = description.slice( found + '[kv-sync '.length );
		var pieces = tail.split( ' ' );
		var date = pieces[ 0 ];

		// Duplikatu nie kasujemy - trzymamy sie pierwszego napotkanego.
		if ( ! byDate[ date ] ) {
			byDate[ date ] = existing[ i ];
		}
	}

	for ( var e = 0; e < input.entries.length; e++ ) {
		var entry = input.entries[ e ];
		var body = entry.description + '\n\n' + marker( entry.date, entry.hash );
		var current = byDate[ entry.date ];

		try {
			if ( ! current ) {
				if ( ! input.dryRun ) {
					calendar.events.push(
						app.Event( {
							summary: entry.summary,
							description: body,
							startDate: midnight( entry.date ),
							endDate: nextDay( entry.date ),
							alldayEvent: true,
						} )
					);
				}

				report.created++;
				continue;
			}

			var existingDescription = current.description() || '';

			if ( -1 !== existingDescription.indexOf( marker( entry.date, entry.hash ) ) ) {
				report.unchanged++;
				continue;
			}

			if ( ! input.dryRun ) {
				current.summary = entry.summary;
				current.description = body;
			}

			report.updated++;
		} catch ( error ) {
			report.errors.push( entry.date + ': ' + error.message );
			report.skipped++;
		}
	}

	return JSON.stringify( report );
}
