/**
 * Jadlospis z publicznej strony - BEZ logowania.
 *
 * Panel klienta pokazuje jedna diete: te, ktora sam zamowiles. Publiczna
 * strona pokazuje wszystkie, wiec da sie z niej zbudowac pelny jadlospis
 * bez podawania jakichkolwiek hasel.
 *
 * Strona stoi na WordPressie, ktory sam z siebie wystawia REST API. Zamiast
 * scrapowac HTML pytamy wiec /wp-json o typy tresci i czytamy je jako JSON.
 * Ktory dokladnie typ przechowuje jadlospis i jak nazywaja sie jego pola -
 * tego z gory nie wiadomo (kazda instalacja nazywa je po swojemu), dlatego
 * mapowanie ponizej jest tolerancyjne: szuka pol po znaczeniu, nie po jednej
 * sztywnej nazwie. Wydruk `npm run discover` pokazuje, co strona faktycznie
 * ma - jesli nazwy sa inne, dopisuje sie je do FIELDS i to cala zmiana.
 */

const DEFAULT_SITE = 'https://kuchniavikinga.pl';

// Typy tresci i pola rozpoznajemy po tych slowach.
const MENU_TYPE = /jad|menu|diet|posi|dan|przepis/;

const FIELDS = {
	date: [ 'data', 'date', 'dzien', 'day', 'datadnia', 'menudate', 'dataposilku' ],
	diet: [ 'dieta', 'diet', 'wariant', 'plan', 'nazwadiety', 'dietname', 'rodzajdiety' ],
	meals: [ 'posilki', 'meals', 'dania', 'menu', 'jadlospis' ],
	mealType: [ 'typ', 'rodzaj', 'type', 'pora', 'meal', 'posilek', 'slug' ],
	mealName: [ 'nazwa', 'name', 'tytul', 'title', 'danie', 'dish' ],
	description: [ 'opis', 'description', 'tresc', 'content', 'szczegoly' ],
	kcal: [ 'kcal', 'kalorie', 'energia', 'calories', 'wartoscenergetyczna' ],
	protein: [ 'bialko', 'protein', 'proteiny' ],
	carbs: [ 'weglowodany', 'wegle', 'carbs', 'carbohydrates' ],
	fat: [ 'tluszcz', 'tluszcze', 'fat', 'fats' ],
	ingredients: [ 'skladniki', 'ingredients', 'sklad' ],
	allergens: [ 'alergeny', 'allergens', 'alergen' ],
};

// Nazwy posilkow, ktore moga stac wprost jako pola dnia (bez tablicy).
const MEAL_NAMES = {
	sniadanie: 'Śniadanie',
	'ii-sniadanie': 'II Śniadanie',
	'drugie-sniadanie': 'II Śniadanie',
	obiad: 'Obiad',
	podwieczorek: 'Podwieczorek',
	kolacja: 'Kolacja',
	przekaska: 'Przekąska',
};

const MONTHS = [
	'stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca',
	'lipca', 'sierpnia', 'wrzesnia', 'pazdziernika', 'listopada', 'grudnia',
];

export class PublicMenuError extends Error {}

/** Polskie znaki na ASCII - uzywane i do slugow, i do porownywania nazw pol. */
export function deaccent( value ) {
	const map = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

	return String( value ?? '' ).toLowerCase().replace( /[ąćęłńóśźż]/g, ( char ) => map[ char ] || char );
}

/** Slug posilku - dokladnie taki sam jak ten z panelu, zeby wiersze sie zgadzaly. */
export function slugify( value ) {
	return deaccent( value ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
}

/** Nazwa pola bez ozdobnikow: "Wartość_energetyczna " -> "wartoscenergetyczna". */
function keyOf( value ) {
	return deaccent( value ).replace( /[^a-z0-9]/g, '' );
}

/**
 * Pierwsze pole obiektu pasujace do ktorejs z nazw. Porownanie po znaczeniu:
 * "kcal", "Kcal", "kcal_posilku" i "wartość energetyczna" to to samo pole.
 *
 * @param {object}   source Obiekt z danymi.
 * @param {string[]} names  Nazwy do rozpoznania.
 */
export function pick( source, names ) {
	if ( ! source || 'object' !== typeof source ) {
		return undefined;
	}

	const wanted = names.map( keyOf );
	const entries = Object.entries( source ).map( ( [ key, value ] ) => [ keyOf( key ), value ] );

	for ( const name of wanted ) {
		const exact = entries.find( ( [ key ] ) => key === name );

		if ( exact && '' !== exact[ 1 ] && null !== exact[ 1 ] && undefined !== exact[ 1 ] ) {
			return exact[ 1 ];
		}
	}

	for ( const name of wanted ) {
		const partial = entries.find( ( [ key ] ) => key.includes( name ) );

		if ( partial && '' !== partial[ 1 ] && null !== partial[ 1 ] && undefined !== partial[ 1 ] ) {
			return partial[ 1 ];
		}
	}

	return undefined;
}

/** Tekst z pola, ktore w WordPressie bywa i stringiem, i {rendered}, i tablica. */
export function text( value ) {
	if ( null === value || undefined === value ) {
		return '';
	}

	if ( Array.isArray( value ) ) {
		return value.map( text ).filter( Boolean ).join( ', ' );
	}

	if ( 'object' === typeof value ) {
		return text( value.rendered ?? value.name ?? value.title ?? value.label ?? value.value ?? '' );
	}

	return String( value )
		.replace( /<[^>]*>/g, ' ' )
		.replace( /&nbsp;/g, ' ' )
		.replace( /&amp;/g, '&' )
		.replace( /&quot;/g, '"' )
		.replace( /&#0?39;|&apos;/g, "'" )
		.replace( /\s+/g, ' ' )
		.trim();
}

/** Sama liczba z "479 kcal", "46,7 g", "1 601 kcal". */
export function number( value ) {
	const match = text( value ).replace( / /g, ' ' ).match( /-?[\d ]*[\d][.,]?\d*/ );

	return match ? match[ 0 ].replace( / /g, '' ).replace( ',', '.' ) : '';
}

/**
 * Data w formacie RRRR-MM-DD z tego, co daje strona: ISO, 04.09.2026,
 * 20260904 (format ACF) albo "4 września 2026".
 *
 * @param {*}      value Wartosc z pola.
 * @param {string} today Data odniesienia dla zapisow bez roku.
 */
export function toIsoDate( value, today = new Date().toISOString().slice( 0, 10 ) ) {
	const raw = text( value );

	if ( ! raw ) {
		return '';
	}

	const iso = raw.match( /(\d{4})-(\d{2})-(\d{2})/ );

	if ( iso ) {
		return `${ iso[ 1 ] }-${ iso[ 2 ] }-${ iso[ 3 ] }`;
	}

	const dotted = raw.match( /(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/ );

	if ( dotted ) {
		return `${ dotted[ 3 ] }-${ dotted[ 2 ].padStart( 2, '0' ) }-${ dotted[ 1 ].padStart( 2, '0' ) }`;
	}

	const compact = raw.match( /^(\d{4})(\d{2})(\d{2})$/ );

	if ( compact ) {
		return `${ compact[ 1 ] }-${ compact[ 2 ] }-${ compact[ 3 ] }`;
	}

	// Przechodzimy wszystkie pary "liczba slowo", bo tytul lubi zaczynac sie od
	// czegos zupelnie innego ("Smart 1500 kcal — 4 wrzesnia").
	for ( const named of deaccent( raw ).matchAll( /(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?/g ) ) {
		const month = MONTHS.indexOf( named[ 2 ] );

		if ( -1 === month ) {
			continue;
		}

		// Bez roku bierzemy biezacy; jadlospis dotyczy najblizszych dni,
		// wiec data wczesniejsza niz dzis o ponad pol roku to nastepny rok.
		const year = named[ 3 ] ? Number( named[ 3 ] ) : yearFor( month, Number( named[ 1 ] ), today );

		return `${ year }-${ String( month + 1 ).padStart( 2, '0' ) }-${ named[ 1 ].padStart( 2, '0' ) }`;
	}

	return '';
}

function yearFor( month, day, today ) {
	const year = Number( today.slice( 0, 4 ) );
	const candidate = `${ year }-${ String( month + 1 ).padStart( 2, '0' ) }-${ String( day ).padStart( 2, '0' ) }`;

	return candidate < addMonths( today, -6 ) ? year + 1 : year;
}

function addMonths( date, months ) {
	const parsed = new Date( `${ date }T00:00:00Z` );

	parsed.setUTCMonth( parsed.getUTCMonth() + months );

	return parsed.toISOString().slice( 0, 10 );
}

/** Wartosci odzywcze w zapisie panelu - dzieki temu archiwum czyta je tak samo. */
function nutritionOf( source ) {
	const values = [
		[ number( pick( source, FIELDS.kcal ) ), 'kcal' ],
		[ number( pick( source, FIELDS.protein ) ), 'B' ],
		[ number( pick( source, FIELDS.carbs ) ), 'W' ],
		[ number( pick( source, FIELDS.fat ) ), 'T' ],
	];

	const out = [];

	for ( const [ value, label ] of values ) {
		if ( '' === value ) {
			continue;
		}

		out.push( 'kcal' === label ? `${ value }kcal` : `${ label }: ${ value }g` );
	}

	return out;
}

/**
 * Jeden posilek: z obiektu w tablicy posilkow albo z pola dnia typu "obiad".
 *
 * @param {*}      source Dane posilku.
 * @param {string} fallbackType Nazwa posilku, gdy nie ma jej w danych.
 */
export function toMeal( source, fallbackType = '' ) {
	// Najprostszy wypadek: pole "obiad" trzyma sam opis dania.
	if ( 'string' === typeof source ) {
		return {
			slug: slugify( fallbackType ),
			name: fallbackType,
			description: text( source ),
			nutrition: [],
			details: {},
		};
	}

	const type = text( pick( source, FIELDS.mealType ) ) || fallbackType;
	const name = text( pick( source, FIELDS.mealName ) );
	// Panel trzyma w "name" pore posilku, a w "description" danie - trzymamy sie tego.
	const description = text( pick( source, FIELDS.description ) ) || ( type ? name : '' );
	const details = {};
	const ingredients = text( pick( source, FIELDS.ingredients ) );
	const allergens = text( pick( source, FIELDS.allergens ) );

	if ( ingredients ) {
		details[ 'Składniki' ] = ingredients;
	}

	if ( allergens ) {
		details[ 'Alergeny' ] = allergens;
	}

	return {
		slug: slugify( type || name ),
		name: type || name,
		description,
		nutrition: nutritionOf( source ),
		details,
	};
}

/**
 * Wpis z WordPressa na dzien jadlospisu.
 *
 * @param {object} entry Wpis z REST API.
 * @param {object} opts  { today, diet }
 *
 * @returns {{date: string, diet: string, meals: Array}|null}
 */
export function toDay( entry, opts = {} ) {
	const fields = { ...entry, ...( entry?.meta || {} ), ...( entry?.acf || {} ) };
	const title = text( entry?.title );
	const date = toIsoDate( pick( fields, FIELDS.date ) || entry?.date || title, opts.today );

	if ( ! date ) {
		return null;
	}

	// Dieta bywa polem, bywa taksonomia, a bywa tylko w tytule ("Smart 1500 — 4 września").
	const diet =
		text( pick( fields, FIELDS.diet ) ) ||
		opts.diet ||
		title.split( /\s+[—–-]\s+/ )[ 0 ].replace( /\s*\d{1,2}\s+\w+\s*$/, '' ).trim();

	const meals = [];
	// Pole z posilkami musi byc tablica - inaczej zlapaloby sie np. "menu_order",
	// ktore WordPress dodaje do kazdego wpisu.
	const arrays = Object.fromEntries( Object.entries( fields ).filter( ( [ , value ] ) => Array.isArray( value ) ) );
	const list = pick( arrays, FIELDS.meals );

	if ( Array.isArray( list ) ) {
		for ( const item of list ) {
			const meal = toMeal( item );

			if ( meal.name || meal.description ) {
				meals.push( meal );
			}
		}
	}

	if ( 0 === meals.length ) {
		// Plaski zapis: osobne pole na sniadanie, obiad i kolacje.
		for ( const [ slug, label ] of Object.entries( MEAL_NAMES ) ) {
			const found = Object.entries( fields ).find( ( [ key ] ) => keyOf( key ) === keyOf( slug ) );

			if ( ! found || ! found[ 1 ] ) {
				continue;
			}

			const meal = toMeal( found[ 1 ], label );

			if ( meal.description || meal.name ) {
				meals.push( meal );
			}
		}
	}

	if ( 0 === meals.length ) {
		return null;
	}

	return { date, diet, meals };
}

/** Laczy wpisy w dni: ten sam dzien tej samej diety to jeden wpis. */
export function toDays( entries, opts = {} ) {
	const days = new Map();

	for ( const entry of entries || [] ) {
		const day = toDay( entry, opts );

		if ( ! day ) {
			continue;
		}

		const key = `${ day.date }|${ day.diet }`;
		const existing = days.get( key );

		if ( ! existing ) {
			days.set( key, day );
			continue;
		}

		for ( const meal of day.meals ) {
			if ( ! existing.meals.some( ( have ) => have.slug === meal.slug ) ) {
				existing.meals.push( meal );
			}
		}
	}

	return [ ...days.values() ].sort(
		( a, b ) => a.date.localeCompare( b.date ) || a.diet.localeCompare( b.diet )
	);
}

/**
 * Czyta publiczna strone i oddaje dni jadlospisu wszystkich diet.
 *
 * @param {object} opts { site, fetch, log, today, perPage, maxPages }
 */
export async function readPublicMenu( opts = {} ) {
	const site = ( opts.site || DEFAULT_SITE ).replace( /\/+$/, '' );
	const fetchImpl = opts.fetch || globalThis.fetch;
	const log = opts.log || ( () => {} );
	const perPage = opts.perPage || 100;
	const maxPages = opts.maxPages || 20;

	async function json( path ) {
		let response;

		try {
			response = await fetchImpl( `${ site }${ path }`, {
				// Naglowki HTTP przyjmuja tylko ASCII - polskie znaki wywalaja fetch.
				headers: { 'User-Agent': 'kuchnia-vikinga-menu/1.0 (public menu reader)', Accept: 'application/json' },
				redirect: 'follow',
			} );
		} catch ( error ) {
			throw new PublicMenuError( `Nie udało się połączyć z ${ site }: ${ error.message }` );
		}

		if ( ! response.ok ) {
			return { ok: false, status: response.status, data: null };
		}

		try {
			return { ok: true, status: response.status, data: await response.json() };
		} catch ( error ) {
			return { ok: false, status: response.status, data: null };
		}
	}

	const types = await json( '/wp-json/wp/v2/types' );

	if ( ! types.ok ) {
		throw new PublicMenuError(
			`${ site } nie wystawia REST API WordPressa (HTTP ${ types.status }). ` +
				'Bez logowania nie ma stąd czego czytać — uruchom `npm run discover` i pokaż wydruk.'
		);
	}

	const bases = [];

	for ( const [ slug, type ] of Object.entries( types.data || {} ) ) {
		if ( ! type?.rest_base || ! MENU_TYPE.test( deaccent( `${ slug } ${ type.name || '' }` ) ) ) {
			continue;
		}

		bases.push( type.rest_base );
	}

	if ( 0 === bases.length ) {
		throw new PublicMenuError(
			'REST API działa, ale nie ma w nim typu treści z jadłospisem. ' +
				'Uruchom `npm run discover` i pokaż wydruk — dopiszemy właściwy adres.'
		);
	}

	const entries = [];

	for ( const base of bases ) {
		let page = 1;

		while ( page <= maxPages ) {
			const batch = await json( `/wp-json/wp/v2/${ base }?per_page=${ perPage }&page=${ page }` );

			if ( ! batch.ok || ! Array.isArray( batch.data ) ) {
				break;
			}

			entries.push( ...batch.data );

			if ( batch.data.length < perPage ) {
				break;
			}

			page++;
		}

		log( `  ${ base }: ${ entries.length } wpisów łącznie` );
	}

	const days = toDays( entries, { today: opts.today } );
	const diets = new Set( days.map( ( day ) => day.diet ).filter( Boolean ) );
	const dates = new Set( days.map( ( day ) => day.date ) );

	log( `Publiczny jadłospis: ${ dates.size } dni w ${ diets.size || 1 } dietach.` );

	return days;
}
