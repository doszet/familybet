# Rodzinny typer

Webowa gra do typowania wynikow meczow na mistrzostwa swiata. Frontend jest w React + Vite, backend w Cloudflare Pages Functions, a dane trzyma Cloudflare D1.

## Co jest gotowe

- dodawanie zawodnikow
- dodawanie meczow
- zapisywanie typow dla wybranego zawodnika
- wpisywanie koncowego wyniku meczu
- automatyczna punktacja: 3 pkt za dokladny wynik, 1 pkt za dobry zwyciezca/remis, 0 pkt za pudlo
- tabela wynikow i historia zakonczonych meczow
- responsywny widok na telefon

## Lokalnie

```bash
npm install
npm run build
```

Do lokalnej pracy z baza D1 uzyj Wrangler:

```bash
npx wrangler d1 create family-bet
```

Wklej zwrocone `database_id` do `wrangler.toml`, potem:

```bash
npx wrangler d1 execute family-bet --local --file=./schema.sql
npx wrangler pages dev dist --d1 DB=family-bet
```

## Cloudflare Pages

1. Utworz baze:

```bash
npx wrangler d1 create family-bet
```

2. Wklej `database_id` do `wrangler.toml`.

3. Wgraj schemat na produkcyjna baze:

```bash
npx wrangler d1 execute family-bet --remote --file=./schema.sql
```

4. W Cloudflare Pages ustaw:

- build command: `npm run build`
- output directory: `dist`
- D1 binding: `DB` -> baza `family-bet`

## API z meczami

Automatyczny importer ma przygotowany endpoint `POST /api/import-matches`, ale wymaga wybranego dostawcy danych i tokenu. Darmowe opcje, ktore warto sprawdzic: football-data.org, API-Football z limitem free tier albo otwarte projekty z fixture API. Po wyborze dostawcy najwygodniej dopisac mapowanie odpowiedzi w `functions/api/[[path]].ts`.
