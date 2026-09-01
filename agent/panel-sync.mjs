/**
 * Logowanie do panelu klienta i odczyt jadlospisu - przez przegladarke sterowana
 * Playwrightem, bo panel to aplikacja React bez publicznego API.
 *
 * Dane dostepowe wylacznie ze zmiennych srodowiskowych (agent/.env, poza repozytorium):
 *
 *   KV_PANEL_URL       https://panel.kuchniavikinga.pl
 *   KV_PANEL_USER      adres e-mail konta
 *   KV_PANEL_PASSWORD  hasło
 *
 * Gdy poznamy adresy API panelu (zakładka Sieć w narzędziach deweloperskich),
 * ten plik da się zastąpić zwykłymi zapytaniami HTTP - reszta łańcucha zostaje.
 */

import { extractDates, extractDay, extractSidebarDetails } from './panel-scrape.mjs';

const SELECTORS = {
	user: '#username',
	password: '#password',
	submit: 'button[type="submit"]',
	dayCard: '#dayDetailsCard',
	dayHeading: '#day-details-date',
	mealCard: 'ul.dashboard-meals-list > li.enhanced-meal-card',
	calendar: '.calendar-slider-items',
	sidebar: '#sideBar',
};

/**
 * @param {object} options { panelUrl, user, password, headless, timeout, log }
 */
export async function withPanel( options, callback ) {
	const { chromium } = await import( 'playwright' );
	const log = options.log || ( () => {} );

	const browser = await chromium.launch( {
		headless: false !== options.headless,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
	} );

	try {
		const context = await browser.newContext( { locale: 'pl-PL' } );
		const page = await context.newPage();

		page.setDefaultTimeout( options.timeout || 30000 );

		log( 'Logowanie do panelu…' );

		await page.goto( `${ options.panelUrl.replace( /\/+$/, '' ) }/logowanie`, { waitUntil: 'domcontentloaded' } );
		await page.fill( SELECTORS.user, options.user );
		await page.fill( SELECTORS.password, options.password );
		await page.click( SELECTORS.submit );

		// Po zalogowaniu panel pokazuje kalendarz zamowienia.
		await page.waitForSelector( SELECTORS.calendar, { timeout: options.timeout || 30000 } );

		log( 'Zalogowano.' );

		return await callback( page, log );
	} finally {
		await browser.close();
	}
}

/**
 * Przechodzi po dniach kalendarza i zbiera jadlospis.
 *
 * @param {object} page  Strona Playwrighta.
 * @param {object} opts  { from, to, log }
 */
export async function collectDays( page, opts = {} ) {
	const log = opts.log || ( () => {} );
	const { dates } = await page.evaluate( extractDates );

	const wanted = dates.filter( ( date ) => {
		if ( opts.from && date < opts.from ) {
			return false;
		}

		return ! ( opts.to && date > opts.to );
	} );

	log( `Kalendarz pokazuje ${ dates.length } dni, do pobrania ${ wanted.length }.` );

	const days = [];

	for ( const date of wanted ) {
		const opened = await openDay( page, date );

		if ( ! opened ) {
			log( `  ${ date }: nie udało się otworzyć, pomijam.` );
			continue;
		}

		const day = await page.evaluate( extractDay );

		if ( day.date !== date ) {
			log( `  ${ date }: panel pokazał ${ day.date }, pomijam.` );
			continue;
		}

		if ( 0 === day.meals.length ) {
			log( `  ${ date }: brak posiłków (dzień bez dostawy).` );
			continue;
		}

		if ( opts.details ) {
			await addMealDetails( page, day, log );
		}

		log( `  ${ date }: ${ day.meals.length } posiłków.` );
		days.push( day );
	}

	return days;
}

/**
 * Klika w dzien i czeka, az karta dnia faktycznie go pokaze.
 * Zwraca false, gdy dzien jest nieklikalny albo panel nie zdazyl sie przelaczyc.
 */
async function openDay( page, date ) {
	const tile = page.locator( `[data-date="${ date }"] li.day` ).first();

	if ( 0 === ( await tile.count() ) ) {
		return false;
	}

	// Dni bez dostawy sa wygaszone - nie ma czego z nich czytac.
	if ( await tile.evaluate( ( node ) => node.classList.contains( 'is-disabled' ) ) ) {
		return false;
	}

	await tile.click();

	try {
		await page.waitForFunction(
			( expected ) => {
				var holders = document.querySelectorAll( '.calendar-slider-items [data-date]' );

				for ( var i = 0; i < holders.length; i++ ) {
					if ( holders[ i ].querySelector( 'li.day.is-selected' ) ) {
						return holders[ i ].getAttribute( 'data-date' ) === expected;
					}
				}

				return false;
			},
			date,
			{ timeout: 10000 }
		);
	} catch {
		return false;
	}

	return true;
}

/**
 * Otwiera boczny panel kazdego posilku i zbiera z niego szczegoly.
 *
 * ROBIMY TU WYLACZNIE DWIE RZECZY: klikamy w opis dania i zamykamy panel
 * klawiszem Escape. Nic wewnatrz panelu nie jest klikane - w tej aplikacji
 * sa akcje zmieniajace zamowienie i pomylka kosztowalaby realne pieniadze.
 */
async function addMealDetails( page, day, log ) {
	for ( let index = 0; index < day.meals.length; index++ ) {
		const content = page.locator( `${ SELECTORS.mealCard } ${ '.meal-content' }` ).nth( index );

		if ( 0 === ( await content.count() ) ) {
			continue;
		}

		try {
			await content.click();

			// Panel wsuwa sie z boku - czekamy, az faktycznie cos w nim bedzie.
			await page.waitForFunction(
				( selector ) => {
					var node = document.querySelector( selector );

					return Boolean( node ) && node.textContent.trim().length > 0;
				},
				SELECTORS.sidebar,
				{ timeout: 5000 }
			);

			day.meals[ index ].details = await page.evaluate( extractSidebarDetails );
		} catch {
			log( `    ${ day.date } / ${ day.meals[ index ].slug }: nie udało się odczytać szczegółów.` );
		} finally {
			// Escape zamyka panel bez dotykania czegokolwiek w środku.
			await page.keyboard.press( 'Escape' );
			await page.waitForTimeout( 250 );
		}
	}
}
