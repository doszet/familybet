import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Player = { id: number; name: string; created_at: string };
type Match = {
  id: number;
  external_id: string | null;
  home_team: string;
  away_team: string;
  starts_at: string;
  status: "scheduled" | "finished";
  home_score: number | null;
  away_score: number | null;
};
type Prediction = {
  id: number;
  match_id: number;
  player_id: number;
  home_score: number;
  away_score: number;
  points: number;
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
  standings: Standing[];
};

const emptyState: AppState = {
  players: [],
  matches: [],
  predictions: [],
  standings: [],
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: "Blad API" }));
    throw new Error(error.error || "Nie udalo sie zapisac danych");
  }
  return res.json();
}

function App() {
  const [data, setData] = useState<AppState>(emptyState);
  const [activePlayer, setActivePlayer] = useState<number | "">("");
  const [message, setMessage] = useState("Ladowanie danych...");
  const [busy, setBusy] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [matchForm, setMatchForm] = useState({ home_team: "", away_team: "" });

  async function load() {
    const next = await api<AppState>("state");
    setData(next);
    setActivePlayer((current) => current || next.players[0]?.id || "");
    setMessage("");
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  const nextMatches = data.matches.filter((match) => match.status === "scheduled");
  const finishedMatches = data.matches.filter((match) => match.status === "finished");

  async function submitPlayer(event: FormEvent) {
    event.preventDefault();
    const name = playerName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api("players", { method: "POST", body: JSON.stringify({ name }) });
      setPlayerName("");
      setMessage(`Dodano zawodnika: ${name}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Blad zapisu");
    } finally {
      setBusy(false);
    }
  }

  async function submitMatch(event: FormEvent) {
    event.preventDefault();
    const home = matchForm.home_team.trim();
    const away = matchForm.away_team.trim();
    if (!home || !away) return;
    setBusy(true);
    try {
      await api("matches", {
        method: "POST",
        body: JSON.stringify({ home_team: home, away_team: away }),
      });
      setMatchForm({ home_team: "", away_team: "" });
      setMessage(`Dodano mecz: ${home} - ${away}`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Blad zapisu");
    } finally {
      setBusy(false);
    }
  }

  async function savePrediction(matchId: number, home: string, away: string) {
    if (!activePlayer || home === "" || away === "") return;
    setBusy(true);
    try {
      await api("predictions", {
        method: "POST",
        body: JSON.stringify({
          match_id: matchId,
          player_id: activePlayer,
          home_score: Number(home),
          away_score: Number(away),
        }),
      });
      setMessage("Zapisano typ.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Blad zapisu");
    } finally {
      setBusy(false);
    }
  }

  async function saveResult(matchId: number, home: string, away: string) {
    if (home === "" || away === "") return;
    setBusy(true);
    try {
      await api(`matches/${matchId}/result`, {
        method: "POST",
        body: JSON.stringify({ home_score: Number(home), away_score: Number(away) }),
      });
      setMessage(`Zapisano wynik ${home}:${away}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Blad zapisu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="hero">
        <div>
          <p className="eyebrow">Rodzinny typer</p>
          <h1>Mistrzostwa swiata 2026</h1>
          <p className="lead">Dodawaj zawodnikow, wpisuj mecze, typuj wyniki i sprawdzaj tabele z jednej wspolnej bazy.</p>
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
              onChange={(event) => setMatchForm({ ...matchForm, home_team: event.target.value })}
              placeholder="Zespol A"
            />
            <input
              value={matchForm.away_team}
              onChange={(event) => setMatchForm({ ...matchForm, away_team: event.target.value })}
              placeholder="Zespol B"
            />
            <button disabled={busy}>Dodaj</button>
          </div>
        </form>
      </section>

      <section className="panel">
        <div className="section-head">
          <h2>Tabela wynikow</h2>
          <span>{data.standings.length} graczy</span>
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
              {data.standings.map((row, index) => (
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
              prediction={
                activePlayer
                  ? data.predictions.find((prediction) => prediction.match_id === match.id && prediction.player_id === activePlayer)
                  : undefined
              }
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
