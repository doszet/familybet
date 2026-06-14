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
    const text = await res.text();
    try {
      const error = JSON.parse(text) as { error?: string };
      throw new Error(error.error || `API zwrocilo blad ${res.status}`);
    } catch {
      throw new Error(text || `API zwrocilo blad ${res.status}`);
    }
  }
  return res.json();
}

function App() {
  const [data, setData] = useState<AppState>(emptyState);
  const [message, setMessage] = useState("Ladowanie danych...");
  const [busy, setBusy] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [matchForm, setMatchForm] = useState({ home_team: "", away_team: "" });
  const [collapseUpcoming, setCollapseUpcoming] = useState(false);

  async function load() {
    try {
      const next = await api<AppState>("state");
      setData(next);
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Nie mozna polaczyc z baza. Sprawdz binding `DB` w Cloudflare Pages i deploy functions."
      );
    }
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

  async function saveMatchPredictions(
    matchId: number,
    predictions: Array<{ player_id: number; home_score: string; away_score: string }>
  ) {
    const payload = predictions.filter((prediction) => prediction.home_score !== "" && prediction.away_score !== "");
    if (!payload.length) return;
    setBusy(true);
    try {
      await Promise.all(
        payload.map((prediction) =>
          api("predictions", {
            method: "POST",
            body: JSON.stringify({
              match_id: matchId,
              player_id: prediction.player_id,
              home_score: Number(prediction.home_score),
              away_score: Number(prediction.away_score),
            }),
          })
        )
      );
      setMessage("Zapisano typy dla meczu.");
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
          <h1 className="hero-title">Mistrzostwa swiata 2026</h1>
          <p className="lead">Dodawaj zawodnikow, wpisuj mecze, typuj wyniki i sprawdzaj tabele z jednej wspolnej bazy.</p>
        </div>
        <div className="rules" aria-label="Punktacja">
          <strong>Punktacja</strong>
          <span>3 pkt za dokladny wynik</span>
          <span>1 pkt za dobry wynik meczu</span>
        </div>
      </section>

      {message && <div className="notice">{message}</div>}

      <section className="grid top-grid">
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
          <div>
            <h2>Nadchodzace mecze</h2>
            <span>{nextMatches.length} do typowania</span>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setCollapseUpcoming((current) => !current)}
          >
            {collapseUpcoming ? "Rozwin wszystkie" : "Zwin wszystkie"}
          </button>
        </div>
        <div className="cards">
          {nextMatches.map((match) => (
            <PredictionCard
              key={match.id}
              match={match}
              players={data.players}
              predictions={data.predictions.filter((prediction) => prediction.match_id === match.id)}
              disabled={busy}
              collapsed={collapseUpcoming}
              onSave={saveMatchPredictions}
              onResult={saveResult}
            />
          ))}
          {!nextMatches.length && <p className="empty">Brak zaplanowanych meczow.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Historia</h2>
            <span>{finishedMatches.length} zakonczonych</span>
          </div>
        </div>
        <div className="history">
          {finishedMatches.map((match) => (
            <HistoryMatch
              key={match.id}
              match={match}
              predictions={data.predictions.filter((prediction) => prediction.match_id === match.id)}
              players={data.players}
            />
          ))}
          {!finishedMatches.length && <p className="empty">Tutaj pojawia sie zakonczone mecze.</p>}
        </div>
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <h2>Lista zawodnikow</h2>
            <span>{data.players.length} osob</span>
          </div>
          <form className="inline-form compact" onSubmit={submitPlayer}>
            <input value={playerName} onChange={(e) => setPlayerName(e.target.value)} placeholder="Imie" />
            <button disabled={busy}>+</button>
          </form>
        </div>
        <div className="players-list">
          {data.players.map((player) => (
            <PlayerChip key={player.id} player={player} onUpdated={load} onError={(text) => setMessage(text)} />
          ))}
          {!data.players.length && <p className="empty">Dodaj pierwszego zawodnika, zeby zaczac typowanie.</p>}
        </div>
      </section>
    </main>
  );
}

function PredictionCard({
  match,
  players,
  predictions,
  disabled,
  collapsed,
  onSave,
  onResult,
}: {
  match: Match;
  players: Player[];
  predictions: Prediction[];
  disabled: boolean;
  collapsed: boolean;
  onSave: (matchId: number, predictions: Array<{ player_id: number; home_score: string; away_score: string }>) => void;
  onResult: (matchId: number, home: string, away: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, { home: string; away: string }>>({});
  const [resultHome, setResultHome] = useState(match.home_score?.toString() ?? "");
  const [resultAway, setResultAway] = useState(match.away_score?.toString() ?? "");
  const [open, setOpen] = useState(!collapsed);

  useEffect(() => {
    const nextDrafts: Record<number, { home: string; away: string }> = {};
    for (const player of players) {
      const prediction = predictions.find((item) => item.player_id === player.id);
      nextDrafts[player.id] = {
        home: prediction?.home_score.toString() ?? "",
        away: prediction?.away_score.toString() ?? "",
      };
    }
    setDrafts(nextDrafts);
  }, [players, predictions, match.id]);

  useEffect(() => {
    setResultHome(match.home_score?.toString() ?? "");
    setResultAway(match.away_score?.toString() ?? "");
  }, [match.home_score, match.away_score]);

  useEffect(() => {
    setOpen(!collapsed);
  }, [collapsed]);

  const betCount = players.filter((player) => {
    const draft = drafts[player.id];
    return Boolean(draft?.home !== "" && draft?.away !== "");
  }).length;

  return (
    <details className="match-card" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="match-summary">
        <div className="match-main">
          <strong>
            {match.home_team} - {match.away_team}
          </strong>
          <span>
            {betCount}/{players.length} osob zrobilo beta
          </span>
        </div>
        <div className="match-summary-right">
          <b>{match.home_score !== null && match.away_score !== null ? `${match.home_score}:${match.away_score}` : "w trakcie"}</b>
        </div>
      </summary>
      <div className="match-body">
        <div className="match-header">
          <div className="match-main">
            <strong>
              {match.home_team} - {match.away_team}
            </strong>
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
        </div>
        <div className="prediction-list">
          {players.map((player) => {
            const draft = drafts[player.id] ?? { home: "", away: "" };
            return (
              <div key={player.id} className="prediction-row">
                <strong>{player.name}</strong>
                <div className="score-form">
                  <input
                    min="0"
                    type="number"
                    value={draft.home}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [player.id]: { ...(current[player.id] ?? { home: "", away: "" }), home: e.target.value },
                      }))
                    }
                  />
                  <span>:</span>
                  <input
                    min="0"
                    type="number"
                    value={draft.away}
                    onChange={(e) =>
                      setDrafts((current) => ({
                        ...current,
                        [player.id]: { ...(current[player.id] ?? { home: "", away: "" }), away: e.target.value },
                      }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          className="save-match"
          disabled={disabled}
          onClick={() => onSave(match.id, Object.entries(drafts).map(([player_id, score]) => ({ player_id: Number(player_id), home_score: score.home, away_score: score.away })))}
        >
          Zapisz typy dla meczu
        </button>
      </div>
    </details>
  );
}

function HistoryMatch({ match, predictions, players }: { match: Match; predictions: Prediction[]; players: Player[] }) {
  const [open, setOpen] = useState(false);
  const result = match.home_score !== null && match.away_score !== null ? { home: match.home_score, away: match.away_score } : null;
  const betCount = players.filter((player) => predictions.some((item) => item.player_id === player.id)).length;

  return (
    <details className="history-row" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="history-summary">
        <div className="history-main">
          <strong>
            {match.home_team} - {match.away_team}
          </strong>
          <span>
            {betCount}/{players.length} typow
          </span>
        </div>
        <b>{result ? `${result.home}:${result.away}` : "brak wyniku"}</b>
      </summary>
      <div className="history-predictions">
        {players.map((player) => {
          const prediction = predictions.find((item) => item.player_id === player.id);
          const state = prediction && result ? getPredictionState(prediction, result) : "neutral";
          return (
            <div key={player.id} className={`history-prediction ${state}`}>
              <strong>{player.name}</strong>
              <span>{prediction ? `${prediction.home_score}:${prediction.away_score}` : "brak typu"}</span>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function getPredictionState(prediction: Prediction, result: { home: number; away: number }) {
  if (prediction.home_score === result.home && prediction.away_score === result.away) return "exact";
  const predictionHomeWin = prediction.home_score > prediction.away_score;
  const predictionAwayWin = prediction.home_score < prediction.away_score;
  const resultHomeWin = result.home > result.away;
  const resultAwayWin = result.home < result.away;
  if (
    (predictionHomeWin && resultHomeWin) ||
    (predictionAwayWin && resultAwayWin) ||
    (!predictionHomeWin && !predictionAwayWin && result.home === result.away)
  ) {
    return "outcome";
  }
  return "wrong";
}

function PlayerChip({
  player,
  onUpdated,
  onError,
}: {
  player: Player;
  onUpdated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(player.name);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(player.name);
  }, [player.name]);

  async function save() {
    const next = name.trim();
    if (!next || next === player.name) {
      setEditing(false);
      return;
    }
    setBusy(true);
    try {
      await api(`players/${player.id}`, {
        method: "PUT",
        body: JSON.stringify({ name: next }),
      });
      setEditing(false);
      await onUpdated();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Blad zapisu");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="player-chip">
      {editing ? (
        <>
          <input value={name} onChange={(event) => setName(event.target.value)} />
          <button type="button" disabled={busy} onClick={save}>
            Zapisz
          </button>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setEditing(false)}>
            Anuluj
          </button>
        </>
      ) : (
        <>
          <span>{player.name}</span>
          <button type="button" className="secondary-button" onClick={() => setEditing(true)}>
            Edytuj
          </button>
        </>
      )}
    </div>
  );
}

function PasswordGate() {
  const [value, setValue] = useState("");

  const submit = () => {
    if (value === import.meta.env.VITE_SITE_PASSWORD) {
      localStorage.setItem("authorized", "true");
      location.reload();
    } else {
      alert("Nieprawidłowe hasło");
    }
  };

  return (
    <div style={{ padding: 40, textAlign: "center" }}>
      <h2>Podaj hasło</h2>

      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />

      <br />
      <br />

      <button onClick={submit}>Wejdź</button>
    </div>
  );
}

const authorized = localStorage.getItem("authorized") === "true";

createRoot(document.getElementById("root")!).render(
  authorized ? <App /> : <PasswordGate />
);