import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Player = { id: number; name: string; created_at: string };
type Match = {
  id: number;
  home_team: string;
  away_team: string;
  status: "scheduled" | "finished";
  home_score: number | null;
  away_score: number | null;
  created_at: string;
};
type Prediction = {
  id: number;
  match_id: number;
  player_id: number;
  home_score: number;
  away_score: number;
  points: number;
  created_at: string;
};
type Standing = {
  player_id: number;
  name: string;
  points: number;
  exact_hits: number;
  outcome_hits: number;
  predictions: number;
};
type AppState = {
  players: Player[];
  matches: Match[];
  predictions: Prediction[];
};

const storageKey = "family-bet-local-v1";

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { players: [], matches: [], predictions: [] };
    return JSON.parse(raw) as AppState;
  } catch {
    return { players: [], matches: [], predictions: [] };
  }
}

function saveState(state: AppState) {
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function scoreOutcome(home: number, away: number) {
  return Math.sign(home - away);
}

function pointsFor(pickHome: number, pickAway: number, home: number | null, away: number | null) {
  if (home === null || away === null) return 0;
  if (pickHome === home && pickAway === away) return 3;
  return scoreOutcome(pickHome, pickAway) === scoreOutcome(home, away) ? 1 : 0;
}

function App() {
  const [data, setData] = useState<AppState>({ players: [], matches: [], predictions: [] });
  const [activePlayer, setActivePlayer] = useState<number | "">("");
  const [message, setMessage] = useState("Dane sa zapisywane lokalnie w przegladarce.");
  const [busy, setBusy] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [matchForm, setMatchForm] = useState({ home_team: "", away_team: "" });

  useEffect(() => {
    const next = loadState();
    setData(next);
    if (next.players[0]) setActivePlayer(next.players[0].id);
  }, []);

  useEffect(() => {
    saveState(data);
  }, [data]);

  const standings = useMemo(() => {
    return data.players
      .map((player) => {
        const playerPredictions = data.predictions.filter((prediction) => prediction.player_id === player.id);
        return {
          player_id: player.id,
          name: player.name,
          points: playerPredictions.reduce((sum, prediction) => sum + prediction.points, 0),
          exact_hits: playerPredictions.filter((prediction) => prediction.points === 3).length,
          outcome_hits: playerPredictions.filter((prediction) => prediction.points > 0).length,
          predictions: playerPredictions.length,
        };
      })
      .sort((a, b) => b.points - a.points || b.exact_hits - a.exact_hits || b.outcome_hits - a.outcome_hits || a.name.localeCompare(b.name));
  }, [data.players, data.predictions]);

  const nextMatches = data.matches.filter((match) => match.status === "scheduled");
  const finishedMatches = data.matches.filter((match) => match.status === "finished");

  async function submitPlayer(event: FormEvent) {
    event.preventDefault();
    const name = playerName.trim();
    if (!name) return;
    setBusy(true);
    const player: Player = {
      id: Date.now(),
      name,
      created_at: new Date().toISOString(),
    };
    setData((current) => ({ ...current, players: [...current.players, player] }));
    setPlayerName("");
    setActivePlayer(player.id);
    setMessage(`Dodano zawodnika: ${name}`);
    setBusy(false);
  }

  async function submitMatch(event: FormEvent) {
    event.preventDefault();
    const home = matchForm.home_team.trim();
    const away = matchForm.away_team.trim();
    if (!home || !away) return;
    setBusy(true);
    const match: Match = {
      id: Date.now(),
      home_team: home,
      away_team: away,
      status: "scheduled",
      home_score: null,
      away_score: null,
      created_at: new Date().toISOString(),
    };
    setData((current) => ({ ...current, matches: [...current.matches, match] }));
    setMatchForm({ home_team: "", away_team: "" });
    setMessage(`Dodano mecz: ${home} - ${away}`);
    setBusy(false);
  }

  function savePrediction(matchId: number, home: string, away: string) {
    if (!activePlayer || home === "" || away === "") return;
    const pickHome = Number(home);
    const pickAway = Number(away);
    setData((current) => {
      const match = current.matches.find((entry) => entry.id === matchId);
      const points = pointsFor(pickHome, pickAway, match?.home_score ?? null, match?.away_score ?? null);
      const filtered = current.predictions.filter((prediction) => !(prediction.match_id === matchId && prediction.player_id === activePlayer));
      const nextPrediction: Prediction = {
        id: Date.now(),
        match_id: matchId,
        player_id: activePlayer,
        home_score: pickHome,
        away_score: pickAway,
        points,
        created_at: new Date().toISOString(),
      };
      return { ...current, predictions: [...filtered, nextPrediction] };
    });
    setMessage("Zapisano typ.");
  }

  function saveResult(matchId: number, home: string, away: string) {
    if (home === "" || away === "") return;
    const homeScore = Number(home);
    const awayScore = Number(away);
    setData((current) => {
      const nextMatches = current.matches.map((match) =>
        match.id === matchId
          ? { ...match, status: "finished" as const, home_score: homeScore, away_score: awayScore }
          : match
      );
      const nextPredictions = current.predictions.map((prediction) => {
        if (prediction.match_id !== matchId) return prediction;
        return {
          ...prediction,
          points: pointsFor(prediction.home_score, prediction.away_score, homeScore, awayScore),
        };
      });
      return { ...current, matches: nextMatches, predictions: nextPredictions };
    });
    setMessage(`Zapisano wynik ${homeScore}:${awayScore}.`);
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Rodzinny typer</p>
          <h1>Mistrzostwa swiata 2026</h1>
          <p className="lead">
            Dodawaj zawodnikow, wpisuj mecze i sprawdzaj tabele wynikow. Wszystko zapisuje sie lokalnie w przegladarce.
          </p>
        </div>
        <div className="rules" aria-label="Punktacja">
          <strong>Punktacja</strong>
          <span>3 pkt za dokladny wynik</span>
          <span>1 pkt za dobry kierunek meczu</span>
        </div>
      </section>

      {message && <div className="notice">{message}</div>}

      <section className="grid top-grid">
        <form className="panel" onSubmit={submitPlayer}>
          <h2>Zawodnicy</h2>
          <div className="inline-form">
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Imie" />
            <button disabled={busy}>Dodaj</button>
          </div>
          <select value={activePlayer} onChange={(e) => setActivePlayer(Number(e.target.value))}>
            <option value="">Wybierz typujacego</option>
            {data.players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
        </form>

        <form className="panel" onSubmit={submitMatch}>
          <h2>Dodaj mecz</h2>
          <div className="match-inputs">
            <input
              value={matchForm.home_team}
              onChange={(e) => setMatchForm({ ...matchForm, home_team: e.target.value })}
              placeholder="Zespol A"
            />
            <input
              value={matchForm.away_team}
              onChange={(e) => setMatchForm({ ...matchForm, away_team: e.target.value })}
              placeholder="Zespol B"
            />
            <button disabled={busy}>Dodaj</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Tabela wynikow</h2>
          <span>{standings.length} graczy</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Gracz</th>
                <th>Punkty</th>
                <th>Dokladne</th>
                <th>Trafione</th>
                <th>Typy</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, index) => (
                <tr key={row.player_id}>
                  <td>{index + 1}</td>
                  <td>{row.name}</td>
                  <td className="points">{row.points}</td>
                  <td>{row.exact_hits}</td>
                  <td>{row.outcome_hits}</td>
                  <td>{row.predictions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Nadchodzace mecze</h2>
          <span>{nextMatches.length} do typowania</span>
        </div>
        <div className="cards">
          {nextMatches.map((match) => (
            <PredictionCard
              key={match.id}
              match={match}
              prediction={activePlayer ? data.predictions.find((prediction) => prediction.match_id === match.id && prediction.player_id === activePlayer) : undefined}
              disabled={!activePlayer || busy}
              onSave={savePrediction}
              onResult={saveResult}
            />
          ))}
          {!nextMatches.length && <p className="empty">Brak zaplanowanych meczow.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Historia</h2>
          <span>{finishedMatches.length} zakonczonych</span>
        </div>
        <div className="history">
          {finishedMatches.map((match) => (
            <article key={match.id} className="history-row">
              <div>
                <strong>
                  {match.home_team} - {match.away_team}
                </strong>
              </div>
              <b>{match.home_score === null || match.away_score === null ? "brak wyniku" : `${match.home_score}:${match.away_score}`}</b>
            </article>
          ))}
          {!finishedMatches.length && <p className="empty">Tutaj pojawia sie zakonczone mecze.</p>}
        </div>
      </section>
    </main>
  );
}

function PredictionCard({
  match,
  prediction,
  disabled,
  onSave,
  onResult,
}: {
  match: Match;
  prediction?: Prediction;
  disabled: boolean;
  onSave: (matchId: number, home: string, away: string) => void;
  onResult: (matchId: number, home: string, away: string) => void;
}) {
  const [home, setHome] = useState(prediction?.home_score.toString() ?? "");
  const [away, setAway] = useState(prediction?.away_score.toString() ?? "");
  const [resultHome, setResultHome] = useState(match.home_score?.toString() ?? "");
  const [resultAway, setResultAway] = useState(match.away_score?.toString() ?? "");

  useEffect(() => {
    setHome(prediction?.home_score.toString() ?? "");
    setAway(prediction?.away_score.toString() ?? "");
  }, [prediction?.home_score, prediction?.away_score]);

  useEffect(() => {
    setResultHome(match.home_score?.toString() ?? "");
    setResultAway(match.away_score?.toString() ?? "");
  }, [match.home_score, match.away_score]);

  return (
    <article className="match-card">
      <div className="match-main">
        <strong>
          {match.home_team} - {match.away_team}
        </strong>
      </div>
      <div className="score-form">
        <input min="0" type="number" value={home} onChange={(e) => setHome(e.target.value)} />
        <span>:</span>
        <input min="0" type="number" value={away} onChange={(e) => setAway(e.target.value)} />
        <button type="button" disabled={disabled} onClick={() => onSave(match.id, home, away)}>
          Zapisz typ
        </button>
      </div>
      <div className="result-form">
        <span>Wynik meczu</span>
        <input min="0" type="number" value={resultHome} onChange={(e) => setResultHome(e.target.value)} />
        <span>:</span>
        <input min="0" type="number" value={resultAway} onChange={(e) => setResultAway(e.target.value)} />
        <button type="button" onClick={() => onResult(match.id, resultHome, resultAway)}>
          Zakoncz
        </button>
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
