type Env = {
  DB: D1Database;
  FOOTBALL_API_KEY?: string;
};

type Ctx = EventContext<Env, string, Record<string, unknown>>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const bad = (error: string, status = 400) => json({ error }, status);

const outcome = (home: number, away: number) => Math.sign(home - away);

const pointsFor = (pickHome: number, pickAway: number, home: number | null, away: number | null) => {
  if (home === null || away === null) return 0;
  if (pickHome === home && pickAway === away) return 3;
  return outcome(pickHome, pickAway) === outcome(home, away) ? 1 : 0;
};

async function readBody<T>(request: Request): Promise<T> {
  return request.json() as Promise<T>;
}

async function state(db: D1Database) {
  const players = await db.prepare("SELECT * FROM players ORDER BY name").all();
  const matches = await db.prepare("SELECT * FROM matches ORDER BY starts_at, id").all();
  const predictions = await db.prepare("SELECT * FROM predictions ORDER BY match_id, player_id").all();
  const standings = await db
    .prepare(
      `SELECT
        p.id AS player_id,
        p.name,
        COALESCE(SUM(pr.points), 0) AS points,
        COALESCE(SUM(CASE WHEN pr.points = 3 THEN 1 ELSE 0 END), 0) AS exact_hits,
        COALESCE(SUM(CASE WHEN pr.points > 0 THEN 1 ELSE 0 END), 0) AS outcome_hits,
        COUNT(pr.id) AS predictions
      FROM players p
      LEFT JOIN predictions pr ON pr.player_id = p.id
      GROUP BY p.id
      ORDER BY points DESC, exact_hits DESC, outcome_hits DESC, p.name`
    )
    .all();

  return json({
    players: players.results,
    matches: matches.results,
    predictions: predictions.results,
    standings: standings.results,
  });
}

async function addPlayer(request: Request, db: D1Database) {
  const body = await readBody<{ name?: string }>(request);
  const name = body.name?.trim();
  if (!name) return bad("Podaj imie zawodnika");
  await db.prepare("INSERT INTO players (name) VALUES (?)").bind(name).run();
  return json({ ok: true }, 201);
}

async function addMatch(request: Request, db: D1Database) {
  const body = await readBody<{ home_team?: string; away_team?: string; starts_at?: string }>(request);
  const home = body.home_team?.trim();
  const away = body.away_team?.trim();
  if (!home || !away || !body.starts_at) return bad("Uzupelnij obie druzyny i date meczu");
  await db
    .prepare("INSERT INTO matches (home_team, away_team, starts_at) VALUES (?, ?, ?)")
    .bind(home, away, new Date(body.starts_at).toISOString())
    .run();
  return json({ ok: true }, 201);
}

async function savePrediction(request: Request, db: D1Database) {
  const body = await readBody<{
    match_id?: number;
    player_id?: number;
    home_score?: number;
    away_score?: number;
  }>(request);
  if (!body.match_id || !body.player_id) return bad("Wybierz mecz i zawodnika");
  if (body.home_score === undefined || body.away_score === undefined) return bad("Podaj typowany wynik");

  const match = await db.prepare("SELECT * FROM matches WHERE id = ?").bind(body.match_id).first<{
    status: string;
    home_score: number | null;
    away_score: number | null;
  }>();
  if (!match) return bad("Nie znaleziono meczu", 404);
  if (match.status === "finished") return bad("Ten mecz jest juz zakonczony");

  const points = pointsFor(body.home_score, body.away_score, match.home_score, match.away_score);
  await db
    .prepare(
      `INSERT INTO predictions (match_id, player_id, home_score, away_score, points)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(match_id, player_id)
      DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score, points = excluded.points`
    )
    .bind(body.match_id, body.player_id, body.home_score, body.away_score, points)
    .run();
  return json({ ok: true });
}

async function saveResult(request: Request, db: D1Database, id: number) {
  const body = await readBody<{ home_score?: number; away_score?: number }>(request);
  if (body.home_score === undefined || body.away_score === undefined) return bad("Podaj wynik meczu");

  await db
    .prepare("UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ?")
    .bind(body.home_score, body.away_score, id)
    .run();

  const picks = await db.prepare("SELECT * FROM predictions WHERE match_id = ?").bind(id).all<{
    id: number;
    home_score: number;
    away_score: number;
  }>();
  const updates = picks.results.map((pick) =>
    db
      .prepare("UPDATE predictions SET points = ? WHERE id = ?")
      .bind(pointsFor(pick.home_score, pick.away_score, body.home_score!, body.away_score!), pick.id)
  );
  if (updates.length) await db.batch(updates);
  return json({ ok: true });
}

async function importMatches(_request: Request, env: Env) {
  if (!env.FOOTBALL_API_KEY) {
    return bad("Dodaj sekret FOOTBALL_API_KEY albo dopisz wlasny importer w functions/api/[[path]].ts", 501);
  }
  return bad("Importer jest przygotowany jako miejsce na darmowe API. Najpewniejsze jest podpiecie wybranego dostawcy po zalozeniu tokenu.", 501);
}

export async function onRequest(context: Ctx) {
  const { request, env } = context;
  const path = new URL(request.url).pathname.replace(/^\/api\/?/, "");
  const method = request.method.toUpperCase();

  try {
    if (method === "GET" && path === "state") return state(env.DB);
    if (method === "POST" && path === "players") return addPlayer(request, env.DB);
    if (method === "POST" && path === "matches") return addMatch(request, env.DB);
    if (method === "POST" && path === "predictions") return savePrediction(request, env.DB);
    if (method === "POST" && path === "import-matches") return importMatches(request, env);

    const resultMatch = path.match(/^matches\/(\d+)\/result$/);
    if (method === "POST" && resultMatch) return saveResult(request, env.DB, Number(resultMatch[1]));

    return bad("Nie znaleziono endpointu", 404);
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Blad serwera", 500);
  }
}
