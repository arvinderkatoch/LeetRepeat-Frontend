import React, { useEffect, useMemo, useState } from "react";
import { apiClient, sessionManager, formatErrorMessage, ApiError } from "./api";

const GOOGLE_CLIENT_ID = process.env.REACT_APP_GOOGLE_CLIENT_ID || "";

const initialQuestionForm = { title: "", link: "", difficulty: "Medium" };

function AnimatedCodingCharacter() {
  return (
    <div className="empty-state">
      <div className="empty-state-character">
        <img
          src="https://media1.tenor.com/m/tkkoPxh0brAAAAAC/typing-anime.gif"
          alt="Typing animation"
          style={{
            width: "280px",
            height: "280px",
            objectFit: "contain",
            filter: "drop-shadow(0 8px 16px rgba(124, 58, 237, 0.15))",
            borderRadius: "12px",
          }}
        />
      </div>
    </div>
  );
}

function App() {
  const [token, setToken] = useState(sessionManager.getToken() || "");
  const [user, setUser] = useState(() => sessionManager.getUser());
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("darkMode");
    return saved ? JSON.parse(saved) : false;
  });

  const [questionForm, setQuestionForm] = useState(initialQuestionForm);
  const [activeQuestions, setActiveQuestions] = useState([]);
  const [archivedQuestions, setArchivedQuestions] = useState([]);
  const [minutesById, setMinutesById] = useState({});
  const [qualityById, setQualityById] = useState({});
  const [filters, setFilters] = useState({
    difficulty: "All",
    sortBy: "next_review_at",
    order: "asc",
    search: "",
    page: 1,
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [pagination, setPagination] = useState(null);

  const dueCount = useMemo(
    () => activeQuestions.filter((question) => question.is_due).length,
    [activeQuestions]
  );

  async function fetchQuestions() {
    if (!token) return;

    try {
      setLoading(true);
      setError("");

      // Fetch active and archived questions in parallel
      const [activeResult, archivedResult] = await Promise.all([
        apiClient.questions.getAll({
          status: "active",
          difficulty: filters.difficulty,
          search: filters.search,
          sortBy: filters.sortBy,
          order: filters.order,
          page: filters.page,
          limit: 25,
        }),
        apiClient.questions.getAll({
          status: "archived",
          sortBy: "created_at",
          order: "desc",
          limit: 25,
        }),
      ]);

      setActiveQuestions(activeResult.data || []);
      setArchivedQuestions(archivedResult.data || []);
      setPagination(activeResult.pagination);
    } catch (err) {
      setError(formatErrorMessage(err, "Could not fetch questions"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchQuestions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filters.difficulty, filters.order, filters.search, filters.sortBy, filters.page]);

  useEffect(() => {
    localStorage.setItem("darkMode", JSON.stringify(darkMode));
    if (darkMode) {
      document.documentElement.classList.add("dark-mode");
    } else {
      document.documentElement.classList.remove("dark-mode");
    }
  }, [darkMode]);

  useEffect(() => {
    if (token) return;

    let cancelled = false;
    let retryTimer = null;

    const initializeGoogleSignIn = () => {
      if (cancelled) return;
      if (!GOOGLE_CLIENT_ID) {
        setError("Google Client ID missing. Set REACT_APP_GOOGLE_CLIENT_ID in frontend .env");
        return;
      }

      const google = window.google;
      const container = document.getElementById("google-signin-button");

      if (!google?.accounts?.id || !container) {
        retryTimer = setTimeout(initializeGoogleSignIn, 250);
        return;
      }

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (response) => {
          try {
            setError("");
            const data = await apiClient.auth.googleAuth(response.credential);

            setToken(data.token);
            setUser(data.user);
            sessionManager.setToken(data.token);
            sessionManager.setUser(data.user);
          } catch (err) {
            setError(formatErrorMessage(err, "Could not authenticate with Google"));
          }
        },
      });

      container.innerHTML = "";
      google.accounts.id.renderButton(container, {
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "continue_with",
        width: 300,
      });
    };

    initializeGoogleSignIn();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [token]);

  function logout() {
    setToken("");
    setUser(null);
    setActiveQuestions([]);
    setArchivedQuestions([]);
    sessionManager.clearSession();
  }

  async function handleAddQuestion(event) {
    event.preventDefault();
    setError("");

    try {
      const data = await apiClient.questions.create(
        questionForm.title,
        questionForm.link,
        questionForm.difficulty
      );

      setQuestionForm(initialQuestionForm);
      setActiveQuestions((prev) => [data, ...prev]);
    } catch (err) {
      setError(formatErrorMessage(err, "Could not add question"));
    }
  }

  async function markReviewed(id) {
    setError("");
    const minutes = Number(minutesById[id] || 0);
    const qualityRaw = qualityById[id];
    const quality = qualityRaw === "" || qualityRaw == null ? undefined : Number(qualityRaw);

    try {
      const data = await apiClient.questions.markReviewed(id, minutes, quality);

      setActiveQuestions((prev) => prev.map((question) => (question.id === id ? data : question)));
      setMinutesById((prev) => ({ ...prev, [id]: "" }));
      setQualityById((prev) => ({ ...prev, [id]: "" }));
    } catch (err) {
      setError(formatErrorMessage(err, "Could not review question"));
    }
  }

  async function archiveQuestion(id) {
    setError("");
    try {
      await apiClient.questions.archive(id);
      fetchQuestions();
    } catch (err) {
      setError(formatErrorMessage(err, "Could not archive question"));
    }
  }

  async function restoreQuestion(id) {
    setError("");
    try {
      await apiClient.questions.restore(id);
      fetchQuestions();
    } catch (err) {
      setError(formatErrorMessage(err, "Could not restore question"));
    }
  }

  async function deleteQuestion(id) {
    setError("");
    if (!window.confirm("Are you sure you want to permanently delete this question? This cannot be undone.")) {
      return;
    }
    try {
      await apiClient.questions.delete(id);
      fetchQuestions();
    } catch (err) {
      setError(formatErrorMessage(err, "Could not delete question"));
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <h1>Leet Repeat</h1>
        {user ? (
          <div className="topbar-user">
            <span className="muted">{user.name || user.email}</span>
            <button 
              className="btn btn-ghost" 
              onClick={() => setDarkMode(!darkMode)}
              title={darkMode ? "Light mode" : "Dark mode"}
              style={{ fontSize: "1.2rem", padding: "12px 16px" }}
            >
              {darkMode ? "☀️" : "🌙"}
            </button>
            <button className="btn btn-ghost" onClick={logout}>
              Logout
            </button>
          </div>
        ) : null}
      </header>

      {!token ? (
        <main className="content-grid single-col">
          <section className="card auth-card">
            <h2>Continue with Google</h2>
            <p className="muted">Sign in to save and sync your revision plan.</p>
            <div className="google-auth-wrap">
              <div id="google-signin-button" />
            </div>
          </section>
        </main>
      ) : (
        <main className="content-grid">
          <section className="card add-card">
            <h2>Add a Question</h2>
            <form onSubmit={handleAddQuestion} className="form-grid">
              <label>
                Title
                <input
                  required
                  value={questionForm.title}
                  onChange={(e) => setQuestionForm((prev) => ({ ...prev, title: e.target.value }))}
                />
              </label>
              <label>
                LeetCode Link
                <input
                  required
                  type="url"
                  value={questionForm.link}
                  onChange={(e) => setQuestionForm((prev) => ({ ...prev, link: e.target.value }))}
                />
              </label>
              <label>
                Difficulty
                <select
                  value={questionForm.difficulty}
                  onChange={(e) => setQuestionForm((prev) => ({ ...prev, difficulty: e.target.value }))}
                >
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              </label>
              <button className="btn btn-primary" type="submit">
                + Add Question
              </button>
            </form>
          </section>

          <section className="card overview-card">
            <h2>Overview</h2>
            <div className="stats">
              <div>
                <span className="muted">Active</span>
                <strong>{activeQuestions.length}</strong>
              </div>
              <div>
                <span className="muted">Due</span>
                <strong>{dueCount}</strong>
              </div>
              <div>
                <span className="muted">Archived</span>
                <strong>{archivedQuestions.length}</strong>
              </div>
            </div>
          </section>

          <section className="card full-width">
            <h2>Filter & Sort</h2>
            <div className="filters-row">
              <label>
                Search
                <input
                  value={filters.search}
                  onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
                  placeholder="Question title"
                />
              </label>
              <label>
                Difficulty
                <select
                  value={filters.difficulty}
                  onChange={(e) => setFilters((prev) => ({ ...prev, difficulty: e.target.value }))}
                >
                  <option value="All">All</option>
                  <option value="Easy">Easy</option>
                  <option value="Medium">Medium</option>
                  <option value="Hard">Hard</option>
                </select>
              </label>
              <label>
                Sort By
                <select
                  value={filters.sortBy}
                  onChange={(e) => setFilters((prev) => ({ ...prev, sortBy: e.target.value }))}
                >
                  <option value="next_review_at">Next Review Date</option>
                  <option value="difficulty">Difficulty</option>
                  <option value="review_count">Revision Count</option>
                  <option value="created_at">Added Date</option>
                </select>
              </label>
              <label>
                Order
                <select
                  value={filters.order}
                  onChange={(e) => setFilters((prev) => ({ ...prev, order: e.target.value }))}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
              </label>
            </div>
          </section>

          <section className="card full-width">
            <h2>Revision Queue</h2>
            {activeQuestions.length === 0 ? <AnimatedCodingCharacter /> : null}
            <div className="list-grid">
              {activeQuestions.map((question) => (
                <article className="question-card" key={question.id}>
                  <div className="question-header">
                    <a href={question.link} target="_blank" rel="noreferrer">
                      {question.title}
                    </a>
                    <span className={`pill ${String(question.difficulty).toLowerCase()}`}>
                      {question.difficulty}
                    </span>
                  </div>
                  <p>
                    Next review: <strong>{question.next_review_at}</strong>
                  </p>
                  <p>{question.is_due ? "🔥 Due now" : `In ${question.days_until_due} day(s)`}</p>
                  <p>
                    Revised <strong>{question.review_count}</strong> times • Total minutes{" "}
                    <strong>{question.total_review_minutes}</strong>
                  </p>

                  <div className="actions">
                    <input
                      type="number"
                      min="0"
                      placeholder="Minutes"
                      value={minutesById[question.id] ?? ""}
                      onChange={(e) =>
                        setMinutesById((prev) => ({ ...prev, [question.id]: e.target.value }))
                      }
                    />
                    <input
                      type="number"
                      min="0"
                      max="5"
                      placeholder="Quality 0-5"
                      value={qualityById[question.id] ?? ""}
                      onChange={(e) =>
                        setQualityById((prev) => ({ ...prev, [question.id]: e.target.value }))
                      }
                    />
                    <button
                      className="btn btn-success"
                      onClick={() => markReviewed(question.id)}
                      disabled={!question.is_due}
                      title={question.is_due ? "Click to mark as revised" : `Available in ${question.days_until_due} day(s)`}
                    >
                      Mark Revised
                    </button>
                    <button className="btn btn-ghost" onClick={() => archiveQuestion(question.id)}>
                      Stop Revising
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="card full-width">
            <h2>Archived Questions</h2>
            {archivedQuestions.length === 0 ? <p className="muted">No archived questions</p> : null}
            <div className="list-grid">
              {archivedQuestions.map((question) => (
                <article className="question-card" key={question.id}>
                  <div className="question-header">
                    <a href={question.link} target="_blank" rel="noreferrer">
                      {question.title}
                    </a>
                    <span className={`pill ${String(question.difficulty).toLowerCase()}`}>
                      {question.difficulty}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
                    <button className="btn btn-primary" onClick={() => restoreQuestion(question.id)}>
                      Put Back in Revision
                    </button>
                    <button className="btn btn-danger" onClick={() => deleteQuestion(question.id)}>
                      Delete Forever
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </main>
      )}

      {loading ? <p className="muted">Loading...</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

export default App;
