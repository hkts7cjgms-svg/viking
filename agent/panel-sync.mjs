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
 * Sesja jest zapisywana na dysk i uzywana ponownie, wiec przy codziennym
 * uruchomieniu formularz logowania wypelnia sie tylko wtedy, gdy sesja wygasla.
 *
 * Gdy poznamy adresy API panelu, ten plik da sie zastapic zwyklymi zapytaniami
 * HTTP - reszta lancucha zostaje bez zmian.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { extractDates, extractDay, extractSidebarDetails } from './panel-scrape.mjs';

const SELECTORS = {
	user: '#username',
	password: '#password',
	submit: 'button[type="submit"]',
	mealContent: '.meal-content',
	mealCard: 'ul.dashboard-meals-list > li.enhanced-meal-card',
	calendar: '.calendar-slider-items',
	sidebar: '#sideBar',
	loginForm: '#username',
};

/** Banery zgod potrafia zaslonic przycisk logowania. */
const COOKIE_BUTTONS = [
	'#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
	'#CybotCookiebotDialogBodyButtonAccept',
	'#CybotCookiebotDialogBodyLevelButtonAccept',
];

export class PanelLoginError extends Error {}

/**
 * @param {object} options { panelUrl, user, password, headless, timeout, sessionPath, log }
 */
export async function withPanel( options, callback ) {
	const { chromium } = await import( 'playwright' );
	const log = options.log || ( () => {} );
	const timeout = options.timeout || 30000;
	const panelUrl = options.panelUrl.replace( /\/+$/, '' );

	const browser = await chromium.launch( {
		headless: false !== options.headless,
		executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
	} );

	try {
		const contextOptions = { locale: 'pl-PL' };

		// Ciasteczka z poprzedniego uruchomienia - jesli sesja zyje, logowanie odpada.
		if ( options.sessionPath && existsSync( options.sessionPath ) ) {
			contextOptions.storageState = options.sessionPath;
		}

		const context = await browser.newContext( contextOptions );
		const page = await context.newPage();

		page.setDefaultTimeout( timeout );

		await page.goto( `${ panelUrl }/`, { waitUntil: 'domcontentloaded' } );
		await dismissCookieBanner( page );

		if ( await isLoggedIn( page, timeout ) ) {
			log( 'Sesja z poprzedniego uruchomienia nadal ważna — logowanie pominięte.' );
		} else {
			await login( page, { panelUrl, user: options.user, password: options.password, timeout, log } );
		}

		if ( options.sessionPath ) {
			mkdirSync( dirname( options.sessionPath ), { recursive: true } );
			await context.storageState( { path: options.sessionPath } );
		}

		return await callback( page, log );
	} finally {
		await browser.close();
	}
}

/**
 * Czy widzimy juz pulpit z kalendarzem, czy jeszcze formularz logowania.
 */
async function isLoggedIn( page, timeout ) {
	try {
		await page.waitForSelector( `${ SELECTORS.calendar }, ${ SELECTORS.loginForm }`, {
			timeout: Math.min( timeout, 15000 ),
		} );
	} catch {
		return false;
	}

	return 0 < ( await page.locator( SELECTORS.calendar ).count() );
}

async function dismissCookieBanner( page ) {
	for ( const selector of COOKIE_BUTTONS ) {
		const button = page.locator( selector );

		try {
			if ( await button.isVisible( { timeout: 1000 } ) ) {
				await button.click( { timeout: 2000 } );

				return;
			}
		} catch {
			// Baneru nie ma albo znikl sam - to nie jest blad.
		}
	}
}

async function login( page, { panelUrl, user, password, timeout, log } ) {
	if ( ! user || ! password ) {
		throw new PanelLoginError( 'Brak KV_PANEL_USER lub KV_PANEL_PASSWORD w agent/.env.' );
	}

	log( 'Sesja wygasła — loguję się do panelu…' );

	await page.goto( `${ panelUrl }/logowanie`, { waitUntil: 'domcontentloaded' } );
	await dismissCookieBanner( page );
	await page.waitForSelector( SELECTORS.user, { timeout } );

	await page.fill( SELECTORS.user, user );
	await page.fill( SELECTORS.password, password );

	// Przycisk jest wylaczony, dopoki formularz nie uzna danych za kompletne.
	const submit = page.locator( SELECTORS.submit ).first();

	try {
		await submit.waitFor( { state: 'visible', timeout } );
		await page.waitForFunction(
			( selector ) => {
				var button = document.querySelector( selector );

				return Boolean( button ) && ! button.disabled;
			},
			SELECTORS.submit,
			{ timeout: 10000 }
		);
	} catch {
		throw new PanelLoginError(
			'Przycisk logowania pozostał nieaktywny — panel nie przyjął danych z formularza. ' +
				'Uruchom z KV_HEADLESS=0, żeby zobaczyć, co się dzieje.'
		);
	}

	await submit.click();

	try {
		await page.waitForSelector( SELECTORS.calendar, { timeout } );
	} catch {
		throw new PanelLoginError( await loginFailureReason( page ) );
	}

	log( 'Zalogowano.' );
}

/**
 * Po nieudanym logowaniu staramy sie powiedziec, co poszlo nie tak, zamiast
 * zrzucac surowy blad oczekiwania na element.
 */
async function loginFailureReason( page ) {
	const message = await page
		.locator( '.Toastify__toast, [role="alert"], .error, .form-error' )
		.first()
		.textContent( { timeout: 2000 } )
		.catch( () => null );

	if ( message && message.trim() ) {
		return `Panel odrzucił logowanie: ${ message.trim() }`;
	}

	if ( 0 < ( await page.locator( SELECTORS.loginForm ).count() ) ) {
		return 'Logowanie nie powiodło się — sprawdź KV_PANEL_USER i KV_PANEL_PASSWORD w agent/.env.';
	}

	return 'Zalogowano, ale panel nie pokazał kalendarza. Możliwe, że nie ma aktywnego zamówienia.';
}

/**
 * Przechodzi po dniach kalendarza i zbiera jadlospis.
 *
 * @param {object} page Strona Playwrighta.
 * @param {object} opts { from, to, details, log }
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
		if ( ! ( await openDay( page, date ) ) ) {
			log( `  ${ date }: dzień niedostępny, pomijam.` );
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
		const content = page.locator( `${ SELECTORS.mealCard } ${ SELECTORS.mealContent }` ).nth( index );

		if ( 0 === ( await content.count() ) ) {
			continue;
		}

		try {
			await content.click();

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
			await page.keyboard.press( 'Escape' );
			await page.waitForTimeout( 250 );
		}
	}
}
