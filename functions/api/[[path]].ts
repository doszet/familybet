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

const requireDb = (db: D1Database | undefined) => {
  if (!db) throw new Error("Brak bindingu DB w Cloudflare Pages Functions. Podlacz baze D1 pod nazwa DB.");
  return db;
};

const outcome = (home: number, away: number) => Math.sign(home - away);

const pointsFor = (pickHome: number, pickAway: number, home: number | null, away: number | null) => {
  if (home === null || away === null) return 0;
  if (pickHome === home && pickAway === away) return 3;
  return outcome(pickHome, pickAway) === outcome(home, away) ? 1 : 0;
};

async function ensureSchema(db: D1Database) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS players (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS matches (id INTEGER PRIMARY KEY AUTOINCREMENT, external_id TEXT UNIQUE, home_team TEXT NOT NULL, away_team TEXT NOT NULL, starts_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'finished')), home_score INTEGER, away_score INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
  ).run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE, home_score INTEGER NOT NULL, away_score INTEGER NOT NULL, points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(match_id, player_id))"
  ).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_predictions_match ON predictions(match_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_predictions_player ON predictions(player_id)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_matches_starts_at ON matches(starts_at)").run();
}

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

async function updatePlayer(request: Request, db: D1Database, id: number) {
  const body = await readBody<{ name?: string }>(request);
  const name = body.name?.trim();
  if (!name) return bad("Podaj imie zawodnika");
  const result = await db.prepare("UPDATE players SET name = ? WHERE id = ?").bind(name, id).run();
  if (!result.meta.changes) return bad("Nie znaleziono zawodnika", 404);
  return json({ ok: true });
}

async function addMatch(request: Request, db: D1Database) {
  const body = await readBody<{
    home_team?: string;
    away_team?: string;
    starts_at?: string | null;
  }>(request);
  const home = body.home_team?.trim();
  const away = body.away_team?.trim();
  if (!home || !away) return bad("Uzupelnij obie druzyny");
  await db
    .prepare("INSERT INTO matches (home_team, away_team, starts_at) VALUES (?, ?, ?)")
    .bind(home, away, body.starts_at || new Date().toISOString())
    .run();
  return json({ ok: true }, 201);
}

async function recalculateMatchPoints(db: D1Database, matchId: number) {
  const match = await db.prepare("SELECT status, home_score, away_score FROM matches WHERE id = ?").bind(matchId).first<{
    status: string;
    home_score: number | null;
    away_score: number | null;
  }>();
  if (!match) return false;

  const picks = await db.prepare("SELECT id, home_score, away_score FROM predictions WHERE match_id = ?").bind(matchId).all<{
    id: number;
    home_score: number;
    away_score: number;
  }>();
  const updates = picks.results.map((pick) => {
    const points =
      match.status === "finished" ? pointsFor(pick.home_score, pick.away_score, match.home_score, match.away_score) : 0;
    return db.prepare("UPDATE predictions SET points = ? WHERE id = ?").bind(points, pick.id);
  });
  if (updates.length) await db.batch(updates);
  return true;
}

async function updateMatch(request: Request, db: D1Database, id: number) {
  const body = await readBody<{
    home_team?: string;
    away_team?: string;
    starts_at?: string | null;
  }>(request);
  const home = body.home_team?.trim();
  const away = body.away_team?.trim();
  if (!home || !away) return bad("Uzupelnij obie druzyny");

  const result = await db
    .prepare("UPDATE matches SET home_team = ?, away_team = ?, starts_at = ? WHERE id = ?")
    .bind(home, away, body.starts_at || new Date().toISOString(), id)
    .run();
  if (!result.meta.changes) return bad("Nie znaleziono meczu", 404);
  return json({ ok: true });
}

async function deleteMatch(db: D1Database, id: number) {
  const result = await db.prepare("DELETE FROM matches WHERE id = ?").bind(id).run();
  if (!result.meta.changes) return bad("Nie znaleziono meczu", 404);
  return json({ ok: true });
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

async function updatePrediction(request: Request, db: D1Database, id: number) {
  const body = await readBody<{ home_score?: number; away_score?: number }>(request);
  if (body.home_score === undefined || body.away_score === undefined) return bad("Podaj typowany wynik");

  const prediction = await db.prepare("SELECT match_id FROM predictions WHERE id = ?").bind(id).first<{ match_id: number }>();
  if (!prediction) return bad("Nie znaleziono typu", 404);

  await db
    .prepare("UPDATE predictions SET home_score = ?, away_score = ? WHERE id = ?")
    .bind(body.home_score, body.away_score, id)
    .run();
  await recalculateMatchPoints(db, prediction.match_id);
  return json({ ok: true });
}

async function saveResult(request: Request, db: D1Database, id: number) {
  const body = await readBody<{ home_score?: number; away_score?: number }>(request);
  if (body.home_score === undefined || body.away_score === undefined) return bad("Podaj wynik meczu");

  await db
    .prepare("UPDATE matches SET home_score = ?, away_score = ?, status = 'finished' WHERE id = ?")
    .bind(body.home_score, body.away_score, id)
    .run();

  await recalculateMatchPoints(db, id);
  return json({ ok: true });
}

async function cancelResult(db: D1Database, id: number) {
  const result = await db
    .prepare("UPDATE matches SET home_score = NULL, away_score = NULL, status = 'scheduled' WHERE id = ?")
    .bind(id)
    .run();
  if (!result.meta.changes) return bad("Nie znaleziono meczu", 404);
  await recalculateMatchPoints(db, id);
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
    const db = requireDb(env.DB);
    await ensureSchema(db);
    if (method === "GET" && path === "state") return state(db);
    if (method === "POST" && path === "players") return addPlayer(request, db);
    if (method === "POST" && path === "matches") return addMatch(request, db);
    if (method === "POST" && path === "predictions") return savePrediction(request, db);
    if (method === "POST" && path === "import-matches") return importMatches(request, env);

    const resultMatch = path.match(/^matches\/(\d+)\/result$/);
    if (method === "POST" && resultMatch) return saveResult(request, db, Number(resultMatch[1]));

    const cancelMatch = path.match(/^matches\/(\d+)\/cancel-result$/);
    if (method === "POST" && cancelMatch) return cancelResult(db, Number(cancelMatch[1]));

    const matchMatch = path.match(/^matches\/(\d+)$/);
    if (method === "PUT" && matchMatch) return updateMatch(request, db, Number(matchMatch[1]));
    if (method === "DELETE" && matchMatch) return deleteMatch(db, Number(matchMatch[1]));

    const predictionMatch = path.match(/^predictions\/(\d+)$/);
    if (method === "PUT" && predictionMatch) return updatePrediction(request, db, Number(predictionMatch[1]));

    const playerMatch = path.match(/^players\/(\d+)$/);
    if (method === "PUT" && playerMatch) return updatePlayer(request, db, Number(playerMatch[1]));

    return bad("Nie znaleziono endpointu", 404);
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Blad serwera", 500);
  }
}
