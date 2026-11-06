# MyMarketApp

This project was generated using [Angular CLI](https://github.com/angular/angular-cli) version 21.2.9.

## Money Flow: Sector Rotation History

The ranking grid reconstructs daily Flow Scores from Alpaca historical constituent
and SPY bars, so it is available immediately when historical data is accessible.
It shows the latest 20 completed trading sessions (or 60 with the range control),
newest on the left, with rank 1 at the top. Today's New York trading date is
excluded, even after close; it appears as history on the next calendar day.
Weekends and holidays do not create columns.

Sector colors are fixed by name. Hover, keyboard-focus, or select a sector in the
grid or legend to follow it; selecting again clears the selection. Cell tooltips
include the date, score, rank, and movement versus the preceding session.
Equal scores are ordered alphabetically. Missing sectors are explicitly shown as
unranked, and rankings on those dates compare only the available sectors.

History uses the current tracked sector universe, not point-in-time membership.
The old live-score localStorage cache is no longer used: rankings are rebuilt
from historical bars to avoid treating intraday snapshots as closing scores.
The live summary table and movers are unchanged.

The **Definition** button next to the **Flow Score** column header opens a modal
dialog with a definition and an illustrative contribution chart:
relative strength of +1.00, breadth tilt of +0.80, and volume direction of +1.20
produce a score of +3.00. Scores indicate inferred rotation, not actual cash flow.
Use **Close** or Escape to dismiss the dialog. The native modal keeps keyboard
focus inside while open and restores focus to the Definition button on dismissal.

Average Breakouts runs only when **Scan for breakouts** is selected. It fetches
fresh snapshots and the longer daily-bar history required for 20-, 50-, and
200-session comparisons. Initialization fetches only the shorter ranking history.
The scan has separate loading, error/retry, empty-result, and refresh states, plus
its own timestamp. Each comparison requires the full number of completed sessions.

## Development server

To start a local development server, run:

```bash
ng serve
```

Once the server is running, open your browser and navigate to `http://localhost:4200/`. The application will automatically reload whenever you modify any of the source files.

## Code scaffolding

Angular CLI includes powerful code scaffolding tools. To generate a new component, run:

```bash
ng generate component component-name
```

For a complete list of available schematics (such as `components`, `directives`, or `pipes`), run:

```bash
ng generate --help
```

## Building

To build the project run:

```bash
ng build
```

This will compile your project and store the build artifacts in the `dist/` directory. By default, the production build optimizes your application for performance and speed.

## Running unit tests

To execute unit tests with the [Vitest](https://vitest.dev/) test runner, use the following command:

```bash
ng test
```

## Running end-to-end tests

For end-to-end (e2e) testing, run:

```bash
ng e2e
```

Angular CLI does not come with an end-to-end testing framework by default. You can choose one that suits your needs.

## Additional Resources

For more information on using the Angular CLI, including detailed command references, visit the [Angular CLI Overview and Command Reference](https://angular.dev/tools/cli) page.
