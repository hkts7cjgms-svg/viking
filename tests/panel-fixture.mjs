/**
 * Fragment odwzorowujacy strukture panelu klienta: kalendarz + karta dnia
 * z posilkami. Zbudowany na podstawie prawdziwego HTML-a panel.kuchniavikinga.pl.
 */

/**
 * @param {{selectedDate?: string, disabled?: string[]}} options Opcje.
 */
export function panelHtml( { selectedDate = '2026-09-02', disabled = [ '2026-09-01' ] } = {} ) {
	const day = ( date ) => `
		<div data-date="${ date }">
			<div class="relative inline-block group">
				<li class="day has-tooltip${ disabled.includes( date ) ? ' is-disabled' : '' }${
					date === selectedDate ? ' is-selected is-active' : ''
				}">
					<div data-date="${ date }" id="calendar-day-${ date }" role="button" tabindex="0">
						<div class="day-header"><div class="h300 day-number">${ Number( date.slice( 8 ) ) }</div></div>
					</div>
				</li>
			</div>
		</div>`;

	const meal = ( id, name, content, kcal ) => `
		<li class="enhanced-meal-card" id="mealCard-${ id }">
			<div class="meal-header" role="button" tabindex="0"><div class="name">${ name } </div></div>
			<div class="meal-content" role="button" tabindex="0"><span class="">${ content }</span></div>
			<div class="meal-nutritions">
				<div class="nutrition-summary">
					<div class="nutrition-summary__item">${ kcal }kcal</div>
					<div class="nutrition-summary__item">B: 46.7g</div>
				</div>
			</div>
		</li>`;

	return `<!doctype html><html><body>
		<div class="calendar-slider-items">${ day( '2026-09-01' ) }${ day( '2026-09-02' ) }${ day( '2026-09-15' ) }</div>
		<div class="card day-details-card" id="dayDetailsCard">
			<div class="card-header"><h3 id="day-details-date">Środa, 2 września</h3></div>
			<div class="card-body">
				<div class="nutrition-day-summary" id="nutrientsDaySummary">
					<div class="nutrition-day-summary__title">Podsumowanie dnia</div>
					<div class="body-l text-gray-700">3 posiłki + 0 dodatków</div>
				</div>
				<ul class="dashboard-meals-list">
					${ meal( 4204325, 'Śniadanie', 'Kanapka z chlebem wiejskim, pieczonym schabem i serem', 479 ) }
					${ meal( 4204326, 'Obiad', 'Pierogi z ziemniakami i twarogiem, okrasa z boczkiem', 589 ) }
					${ meal( 4204327, 'Kolacja', 'Tacos z szarpaną wieprzowiną z chili', 533 ) }
				</ul>
			</div>
		</div>
	</body></html>`;
}
