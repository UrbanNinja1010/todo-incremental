# Todo Incremental — "Number Go Up" 📈

Een incrementele todo-game: elke afgeronde taak is een trekking uit een onzekere beloning.
Geen thema, geen verhaal — alleen een getal dat steeds groter wordt en een backlog die steeds
leger wordt. Gebouwd volgens het ontwerpdocument (variabele-ratio-bekrachtiging,
reward prediction error, verliesaversie met vangnet, self-determination theory).

Puur statisch (HTML/CSS/JS), alle data lokaal in je browser via `localStorage`. Geen backend.

## Wat zit erin

- **Backlog & weging** — taken met grootte (S/M/L/XL), prioriteit en deadline; trekkingskans via `gewicht = prioriteit × (1 + staleness) × (1 + urgentie)`
- **Dagelijkse loting** — 3 gewogen-random taken (schud-animatie!), jij kiest er 1; 1 gratis reroll per dag, extra rerolls kosten oplopend punten
- **Variabele beloning** — basispunten × multiplier-worp: 83% normaal (0,8–1,3×), 12% mooie worp (1,5×), 4% kritiek (2,5×), 1% jackpot (5× + Mystery Box). Nooit 0 punten.
- **Combo's** — volgende taak binnen 4u = +8% cumulatief, max +80%
- **Upgrades** — 7 upgrades, kosten schalen met `basiskosten × 1,15ⁿ`
- **Prestige** — bij 5.000 PT: reset + `PP = round(√(run-PT / 100))`, +2% permanente bonus per PP, oplopend seizoensnummer
- **Streaks + Streak Insurance** — freeze-tokens vangen gemiste dagen op; elke volle week +2% permanent (cap +50%)
- **Mystery Box** — gegarandeerd na de eerste taak van de dag; 1,5s anticipatie-animatie
- **Levels** — elke 500 lifetime-PT, puur cosmetisch, voortgangsbalk altijd in beeld
- **Juice** — tellende getallen, screen-shake + partikels bij kritiek/jackpot
- **Ethische grenzen** — nooit 0 punten, geen nep-countdowns, streak-verlies raakt prestige nooit, de backlog is eindig: leeg = sessie klaar

## Draaien

Open `index.html` in een browser — dat is alles. Of lokaal serveren:

```sh
python3 -m http.server 8000
```

## GitHub Pages

Er staat een workflow klaar in `.github/workflows/pages.yml` die bij elke push naar `main`
automatisch deployt. Eenmalig instellen:

1. Ga naar **Settings → Pages** van deze repository
2. Zet **Source** op **GitHub Actions**
3. Merge/push naar `main` — de site verschijnt op `https://<gebruikersnaam>.github.io/todo-incremental/`

(Alternatief zonder workflow: Settings → Pages → Source: *Deploy from a branch* → `main` / root.)
