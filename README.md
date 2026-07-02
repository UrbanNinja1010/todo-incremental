# Todo Incremental — "Number Go Up" 📈

Een incrementele todo-game: échte taken zijn de enige bron van inkomen, en met dat
inkomen koop je generatoren die het getal vanzelf laten tikken. Geen klik-component,
geen thema, geen verhaal — alleen een getal dat steeds groter wordt en een backlog
die steeds leger wordt. Gebouwd volgens het ontwerpdocument (variabele-ratio-bekrachtiging,
reward prediction error, verliesaversie met vangnet, self-determination theory).

Puur statisch (HTML/CSS/JS), alle data lokaal in je browser via `localStorage`. Geen backend.

## De kernloop

1. **Taken afronden = punten verdienen** — met een variabele multiplier-worp:
   83% normaal (0,8–1,3×), 12% mooie worp (1,5×), 4% kritiek (2,5×), 1% jackpot (5× + Mystery Box). Nooit 0 punten.
2. **Punten kopen generatoren** — 8 tiers die punten per seconde produceren.
   Kosten schalen per aankoop (`× 1,15ⁿ`); bij 10/25/50/100 stuks verdubbelt de output van een tier.
3. **Het getal tikt vanzelf door** — ook offline. Exponentiële groei: traag begin, lange boog.
4. **Taken blijven altijd relevant** — een taak is basispunten + minuten productie waard,
   en geeft een tijdelijke **momentum-boost** (×2 productie). Hoe groter het getal, hoe meer een echte taak oplevert.

## Systemen

- **Backlog & weging** — grootte (S/M/L/XL), prioriteit, deadline; `gewicht = prioriteit × (1 + staleness) × (1 + urgentie)`
- **Dagelijkse loting** — trekt 3 **bonusloten** (gewogen-random, schud-animatie): die taken zijn die dag ×2 waard. Alles blijft altijd afvinkbaar — het lot bepaalt alleen wáár de bonus ligt. 1 gratis reroll per dag, daarna oplopende kosten.
- **Combo's** — volgende taak binnen 4u = +8% cumulatief, max +80%
- **Taak-upgrades** — 8 upgrades (vroege vogel, extra lot, momentum+, jackpotkans, …), kosten `× 1,15ⁿ`
- **Prestige** — `PP = ⌊√(run-PT / 5.000)⌋`, +2% permanente bonus per PP op productie én taken; reset punten/generatoren/upgrades, seizoensnummer telt op
- **Streaks + Streak Insurance** — freeze-tokens vangen gemiste dagen op; elke volle week +2% permanent (cap +50%)
- **Mystery Box** — gegarandeerd na de eerste taak van de dag; 1,5s anticipatie-animatie; puntenbonus schaalt mee met je productie
- **Levels** — lifetime-PT, drempels groeien ×1,35 per level, puur cosmetisch
- **Juice** — tellende getallen, ticker altijd in beeld, screen-shake + partikels bij kritiek/jackpot
- **Ethische grenzen** — nooit 0 punten, geen nep-countdowns, streak-verlies raakt prestige nooit, de backlog is eindig: leeg = sessie klaar (de generatoren tikken rustig door)

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
