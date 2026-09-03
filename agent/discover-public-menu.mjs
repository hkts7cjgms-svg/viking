#!/usr/bin/env node
/**
 * Rozpoznanie: czy kuchniavikinga.pl udostepnia jadlospis BEZ logowania.
 *
 *   node agent/discover-public-menu.mjs
 *
 * Nic nie zapisuje - tylko czyta publiczne adresy i wypisuje, co znalazl.
 * Strona stoi na WordPressie, wiec najpierw pytamy jego wlasne API o typy
 * tresci: jesli jadlospis jest osobnym typem wpisu, dostaniemy dane wprost
 * w JSON-ie, bez zadnego scrapowania.
 */

const SITE = ( process.argv[ 2 ] || 'https://kuchniavikinga.pl' ).replace( /\/+$/, '' );
const log = ( message = '' ) => process.stdout.write( `${ message }\n` );

async function get( path, { json = false } = {} ) {
	const url = path.startsWith( 'http' ) ? path : `${ SITE }${ path }`;

	try {
		const response = await fetch( url, {
			// Naglowki HTTP przyjmuja tylko ASCII - polskie znaki wywalaja fetch.
			headers: { 'User-Agent': 'kuchnia-vikinga-menu/1.0 (public menu discovery)' },
			redirect: 'follow',
		} );

		if ( ! response.ok ) {
			return { ok: false, status: response.status, url };
		}

		const text = await response.text();

		return {
			ok: true,
			status: response.status,
			url: response.url,
			text,
			data: json ? JSON.parse( text ) : null,
		};
	} catch ( error ) {
		return { ok: false, status: 0, url, error: error.message };
	}
}

log( `Sprawdzam ${ SITE }\n` );

// --- 1. Typy treści WordPressa ------------------------------------------
log( '1. Typy treści w WordPressie (/wp-json/wp/v2/types)' );

const types = await get( '/wp-json/wp/v2/types', { json: true } );

if ( ! types.ok ) {
	log( `   ✗ niedostępne (HTTP ${ types.status || types.error }) — REST API może być wyłączone` );
} else {
	const interesting = [];

	for ( const [ slug, type ] of Object.entries( types.data || {} ) ) {
		const name = String( type.name || '' ).toLowerCase();
		const hit = /jad|menu|diet|posi|dan|przepis/.test( `${ slug } ${ name }`.toLowerCase() );

		log( `   ${ hit ? '★' : '·' } ${ slug.padEnd( 24 ) } ${ type.name || '' }` );

		if ( hit && type.rest_base ) {
			interesting.push( type.rest_base );
		}
	}

	// --- 2. Zawartość obiecujących typów --------------------------------
	for ( const base of interesting ) {
		log( `\n2. Zawartość /wp-json/wp/v2/${ base }` );

		const items = await get( `/wp-json/wp/v2/${ base }?per_page=3`, { json: true } );

		if ( ! items.ok ) {
			log( `   ✗ HTTP ${ items.status } — typ istnieje, ale nie jest wystawiony publicznie` );
			continue;
		}

		const list = Array.isArray( items.data ) ? items.data : [];

		log( `   ✓ ${ list.length } przykładowych wpisów` );

		for ( const item of list.slice( 0, 3 ) ) {
			const title = item.title?.rendered || item.slug || '(bez tytułu)';

			log( `     • ${ String( title ).slice( 0, 70 ) }` );
			log( `       pola: ${ Object.keys( item ).slice( 0, 14 ).join( ', ' ) }` );
		}
	}
}

// --- 3. Mapa strony -----------------------------------------------------
log( '\n3. Adresy z mapy strony pasujące do jadłospisu' );

const sitemaps = [ '/wp-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml' ];
const found = new Set();

for ( const path of sitemaps ) {
	const map = await get( path );

	if ( ! map.ok ) {
		continue;
	}

	// Mapa map albo mapa adresów - w obu wypadkach interesują nas <loc>.
	const locs = [ ...map.text.matchAll( /<loc>([^<]+)<\/loc>/g ) ].map( ( m ) => m[ 1 ] );
	const nested = locs.filter( ( loc ) => loc.endsWith( '.xml' ) ).slice( 0, 12 );

	for ( const child of nested ) {
		const sub = await get( child );

		if ( sub.ok ) {
			for ( const m of sub.text.matchAll( /<loc>([^<]+)<\/loc>/g ) ) {
				locs.push( m[ 1 ] );
			}
		}
	}

	for ( const loc of locs ) {
		if ( /jadlospis|menu|diet|posilk/i.test( loc ) && ! loc.endsWith( '.xml' ) ) {
			found.add( loc );
		}
	}

	if ( found.size ) {
		break;
	}
}

if ( 0 === found.size ) {
	log( '   ✗ nic nie pasuje — mapa strony nie zawiera stron z jadłospisem' );
} else {
	for ( const loc of [ ...found ].slice( 0, 25 ) ) {
		log( `   • ${ loc }` );
	}

	if ( found.size > 25 ) {
		log( `   … i ${ found.size - 25 } więcej` );
	}
}

// --- 4. Czy któraś z tych stron ma dane jadłospisu ----------------------
const candidates = [ ...found ].slice( 0, 5 );

if ( candidates.length ) {
	log( '\n4. Czy te strony niosą jadłospis' );

	for ( const url of candidates ) {
		const page = await get( url );

		if ( ! page.ok ) {
			log( `   ✗ ${ url } — HTTP ${ page.status }` );
			continue;
		}

		const marks = {
			'daty (RRRR-MM-DD)': /\d{4}-\d{2}-\d{2}/.test( page.text ),
			'nazwy posiłków': /śniadanie|obiad|kolacja/i.test( page.text ),
			'kalorie': /\d+\s*kcal/i.test( page.text ),
			'dane w JSON': /application\/json|__NEXT_DATA__|window\.\w+\s*=\s*\{/.test( page.text ),
		};

		log( `   ${ url }` );
		log( `     ${ Object.entries( marks ).map( ( [ k, v ] ) => `${ v ? '✓' : '·' } ${ k }` ).join( '   ' ) }` );
	}
}

log( '\nGotowe. Wklej ten wydruk — na jego podstawie powiem, czy da się to zrobić bez logowania.' );
