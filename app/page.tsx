"use client";
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/immutability, react-hooks/exhaustive-deps */

import { useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { canonicalQuestions, flashcards, questions, sourceCoverage, type Flashcard, type Question, type Topic } from "./studyData";
import { accountsConfigured, supabase } from "./supabase";

type View = "home" | "quiz" | "results" | "flashcards" | "sources";
type QuizKind = "baseline" | "practice" | "timed";
type SavedExam = { kind: QuizKind; questionIds: number[]; answers: Record<number, number>; current: number; secondsLeft: number };
type Attempt = { id: string; quiz_kind: QuizKind; score: number; total: number; percent: number; completed_at: string; question_ids?: number[] };
type FeedbackKind = "content_error" | "unclear" | "source_question" | "feature_idea" | "technical";
type FeedbackTarget = { origin: string; questionId?: number; prompt?: string; source?: string };

const shuffle = <T,>(items: T[]) => [...items].sort(() => Math.random() - 0.5);
const topics: Topic[] = ["Command & conduct", "Response readiness", "Work rules", "Fire operations", "EMS & HazMat", "Rescue & safety"];

const buildBalancedQuiz = (count: number, recentlySeen: number[]) => {
  const recent = new Set(recentlySeen);
  const available = questions.filter((question) => !recent.has(question.ruleId));
  const source = available.length >= count ? available : questions;
  const pools = topics.map((topic) => shuffle(source.filter((question) => question.topic === topic)));
  const selected: Question[] = [];
  const selectedRules = new Set<number>();
  while (selected.length < count && pools.some((pool) => pool.length)) {
    for (const pool of pools) {
      let next = pool.pop();
      while (next && selectedRules.has(next.ruleId)) next = pool.pop();
      if (next) {
        selected.push(next);
        selectedRules.add(next.ruleId);
      }
      if (selected.length === count) break;
    }
  }
  if (selected.length < count) {
    for (const question of shuffle(questions)) {
      if (selectedRules.has(question.ruleId)) continue;
      selected.push(question);
      selectedRules.add(question.ruleId);
      if (selected.length === count) break;
    }
  }
  return shuffle(selected);
};

export default function Home() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [view, setView] = useState<View>("home");
  const [quizKind, setQuizKind] = useState<QuizKind>("baseline");
  const [quiz, setQuiz] = useState<Question[]>(questions.slice(0, 25));
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [current, setCurrent] = useState(0);
  const [lastScore, setLastScore] = useState<number | null>(null);
  const [lastAnswers, setLastAnswers] = useState<Record<number, number>>({});
  const [secondsLeft, setSecondsLeft] = useState(25 * 60);
  const [cardIndex, setCardIndex] = useState(0);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardDeck, setCardDeck] = useState<Flashcard[]>(flashcards);
  const [recentQuestionIds, setRecentQuestionIds] = useState<number[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [savedExam, setSavedExam] = useState<SavedExam | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [syncState, setSyncState] = useState<"local" | "syncing" | "saved">("local");
  const [feedbackTarget, setFeedbackTarget] = useState<FeedbackTarget | null>(null);
  const [feedbackKind, setFeedbackKind] = useState<FeedbackKind>("content_error");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");

  useEffect(() => {
    const savedTheme = localStorage.getItem("master-prep-theme") as "dark" | "light" | null;
    const systemLight = window.matchMedia("(prefers-color-scheme: light)").matches;
    setTheme(savedTheme ?? (systemLight ? "light" : "dark"));
    const savedScore = localStorage.getItem("master-prep-score");
    if (savedScore) setLastScore(Number(savedScore));
    const draft = localStorage.getItem("master-prep-active-exam");
    if (draft) {
      try { setSavedExam(JSON.parse(draft)); } catch { localStorage.removeItem("master-prep-active-exam"); }
    }
    const recent = localStorage.getItem("master-prep-recent-questions");
    if (recent) {
      try { setRecentQuestionIds(JSON.parse(recent)); } catch { localStorage.removeItem("master-prep-recent-questions"); }
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!supabase || !user) { setAttempts([]); return; }
    const loadAccount = async () => {
      const [{ data: history }, { data: progress }] = await Promise.all([
        supabase.from("exam_attempts").select("id,quiz_kind,score,total,percent,completed_at,question_ids").order("completed_at", { ascending: false }).limit(8),
        supabase.from("study_progress").select("active_exam,flashcard_index").eq("user_id", user.id).maybeSingle(),
      ]);
      if (history) {
        setAttempts(history as Attempt[]);
        if (history[0]) setLastScore((history[0] as Attempt).percent);
        const cloudRecent = (history as Attempt[]).flatMap((attempt) => attempt.question_ids ?? []).filter((id, index, all) => all.indexOf(id) === index).slice(0, 75);
        if (cloudRecent.length) {
          setRecentQuestionIds(cloudRecent);
          localStorage.setItem("master-prep-recent-questions", JSON.stringify(cloudRecent));
        }
      }
      if (progress?.active_exam) {
        const cloudExam = progress.active_exam as SavedExam;
        setSavedExam(cloudExam);
        localStorage.setItem("master-prep-active-exam", JSON.stringify(cloudExam));
      }
      if (typeof progress?.flashcard_index === "number") setCardIndex(progress.flashcard_index);
    };
    loadAccount();
  }, [user]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("master-prep-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (view !== "quiz" || quizKind !== "timed") return;
    if (secondsLeft <= 0) {
      finishQuiz();
      return;
    }
    const timer = window.setInterval(() => setSecondsLeft((value) => value - 1), 1000);
    return () => window.clearInterval(timer);
  }, [view, quizKind, secondsLeft]);

  useEffect(() => {
    if (view !== "quiz") return;
    const activeExam: SavedExam = { kind: quizKind, questionIds: quiz.map((question) => question.id), answers, current, secondsLeft };
    setSavedExam(activeExam);
    localStorage.setItem("master-prep-active-exam", JSON.stringify(activeExam));
    if (!supabase || !user) { setSyncState("local"); return; }
    setSyncState("syncing");
    const timer = window.setTimeout(async () => {
      const { error } = await supabase.from("study_progress").upsert({ user_id: user.id, active_exam: activeExam, flashcard_index: cardIndex, updated_at: new Date().toISOString() });
      setSyncState(error ? "local" : "saved");
    }, 450);
    return () => window.clearTimeout(timer);
  }, [view, quizKind, quiz, answers, current, secondsLeft, user, cardIndex]);

  useEffect(() => {
    if (!supabase || !user || view === "quiz") return;
    const timer = window.setTimeout(() => {
      supabase.from("study_progress").upsert({ user_id: user.id, active_exam: savedExam, flashcard_index: cardIndex, updated_at: new Date().toISOString() });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [cardIndex, user, view, savedExam]);

  const score = useMemo(
    () => quiz.reduce((total, question) => total + (lastAnswers[question.id] === question.answer ? 1 : 0), 0),
    [quiz, lastAnswers],
  );

  const missedTopics = useMemo(() => {
    const counts = new Map<Topic, number>();
    quiz.forEach((question) => {
      if (lastAnswers[question.id] !== question.answer) {
        counts.set(question.topic, (counts.get(question.topic) ?? 0) + 1);
      }
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [quiz, lastAnswers]);

  const showView = (nextView: View) => {
    setView(nextView);
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  };

  const startQuiz = (kind: QuizKind) => {
    const selected = buildBalancedQuiz(kind === "practice" ? 10 : 25, recentQuestionIds);
    setQuizKind(kind);
    setQuiz(selected);
    setAnswers({});
    setCurrent(0);
    setSecondsLeft(25 * 60);
    showView("quiz");
  };

  const resumeQuiz = () => {
    if (!savedExam) return;
    const restored = savedExam.questionIds.map((id) => questions.find((question) => question.id === id)).filter(Boolean) as Question[];
    if (!restored.length) return;
    setQuizKind(savedExam.kind);
    setQuiz(restored);
    setAnswers(savedExam.answers);
    setCurrent(Math.min(savedExam.current, restored.length - 1));
    setSecondsLeft(savedExam.secondsLeft);
    showView("quiz");
  };

  const finishQuiz = async () => {
    setLastAnswers(answers);
    const earned = quiz.reduce((total, question) => total + (answers[question.id] === question.answer ? 1 : 0), 0);
    const percent = Math.round((earned / quiz.length) * 100);
    setLastScore(percent);
    localStorage.setItem("master-prep-score", String(percent));
    localStorage.removeItem("master-prep-active-exam");
    const updatedRecent = [...quiz.map((question) => question.ruleId), ...recentQuestionIds].filter((id, index, all) => all.indexOf(id) === index).slice(0, 75);
    setRecentQuestionIds(updatedRecent);
    localStorage.setItem("master-prep-recent-questions", JSON.stringify(updatedRecent));
    setSavedExam(null);
    if (supabase && user) {
      const misses = quiz.filter((question) => answers[question.id] !== question.answer).map((question) => question.topic);
      const { data } = await supabase.from("exam_attempts").insert({
        user_id: user.id, quiz_kind: quizKind, score: earned, total: quiz.length, percent,
        answers, question_ids: quiz.map((question) => question.id), missed_topics: misses,
      }).select("id,quiz_kind,score,total,percent,completed_at,question_ids").single();
      await supabase.from("study_progress").upsert({ user_id: user.id, active_exam: null, flashcard_index: cardIndex, updated_at: new Date().toISOString() });
      if (data) setAttempts((currentAttempts) => [data as Attempt, ...currentAttempts].slice(0, 8));
    }
    showView("results");
  };

  const goHome = () => {
    showView("home");
  };

  const sendSignInLink = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase) { setAuthMessage("Account setup is being connected. Please try again shortly."); return; }
    setAuthBusy(true);
    setAuthMessage("");
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.href.split("#")[0] } });
    setAuthBusy(false);
    setAuthMessage(error ? error.message : "Check your email for your secure sign-in link.");
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setAuthOpen(false);
    setAttempts([]);
  };

  const openFeedback = (target: FeedbackTarget = { origin: view }) => {
    setFeedbackTarget(target);
    setFeedbackKind(target.prompt ? "content_error" : "feature_idea");
    setFeedbackMessage("");
    setFeedbackSent(false);
    setFeedbackError("");
  };

  const submitFeedback = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!supabase || !user || !feedbackTarget || !feedbackMessage.trim()) return;
    setFeedbackBusy(true);
    setFeedbackError("");
    const feedbackPayload = {
      user_id: user.id,
      category: feedbackKind,
      message: feedbackMessage.trim(),
      origin: feedbackTarget.origin,
      question_id: feedbackTarget.questionId ?? null,
      content_prompt: feedbackTarget.prompt ?? null,
      source: feedbackTarget.source ?? null,
      app_version: "2026.07",
    };
    const { error } = await supabase.from("feedback").insert(feedbackPayload);
    if (error) {
      setFeedbackBusy(false);
      setFeedbackError("Your note could not be sent. Please check the connection and try again.");
    }
    else {
      await supabase.functions.invoke("send-feedback-email", { body: {
        category: feedbackKind,
        message: feedbackMessage.trim(),
        origin: feedbackTarget.origin,
        questionId: feedbackTarget.questionId ?? null,
        prompt: feedbackTarget.prompt ?? null,
        source: feedbackTarget.source ?? null,
        submitterEmail: user.email,
      } });
      setFeedbackBusy(false);
      setFeedbackSent(true);
    }
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="Master Prep home">
          <span className="brand-mark">MP</span>
          <span><strong>Master Prep</strong><small>KFD PROMOTIONAL STUDY</small></span>
        </button>
        <nav aria-label="Primary navigation">
          <button className={view === "home" ? "active" : ""} onClick={goHome}>Home</button>
          <button className={view === "flashcards" ? "active" : ""} onClick={() => showView("flashcards")}>Flashcards</button>
          <button className={view === "sources" ? "active" : ""} onClick={() => showView("sources")}>Sources</button>
        </nav>
        <div className="header-actions">
          <button className={`account-button ${user ? "signed-in" : ""}`} onClick={() => setAuthOpen(true)} aria-label={user ? "Open my Master Prep account" : "Sign in to Master Prep"}>
            <span aria-hidden="true">{user ? "✓" : "↗"}</span><span>{user ? "My account" : "Sign in"}</span>
          </button>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            <span aria-hidden="true">{theme === "dark" ? "☀" : "◐"}</span>
            <span>{theme === "dark" ? "Light" : "Dark"}</span>
          </button>
        </div>
      </header>

      {authOpen && <AccountPanel user={user} email={email} setEmail={setEmail} message={authMessage} busy={authBusy} configured={accountsConfigured} attempts={attempts} close={() => setAuthOpen(false)} submit={sendSignInLink} signOut={signOut} />}
      {feedbackTarget && <FeedbackPanel target={feedbackTarget} user={user} kind={feedbackKind} setKind={setFeedbackKind} message={feedbackMessage} setMessage={setFeedbackMessage} busy={feedbackBusy} sent={feedbackSent} error={feedbackError} close={() => setFeedbackTarget(null)} submit={submitFeedback} signIn={() => { setFeedbackTarget(null); setAuthOpen(true); }} />}

      <button className="feedback-fab" onClick={() => openFeedback({ origin: view })} aria-label="Send feedback"><span aria-hidden="true">✎</span><span className="feedback-label">Feedback</span></button>

      {view === "home" && <Dashboard lastScore={lastScore} startQuiz={startQuiz} setView={showView} savedExam={savedExam} resumeQuiz={resumeQuiz} user={user} openAccount={() => setAuthOpen(true)} attempts={attempts} />}
      {view === "quiz" && (
        <QuizScreen
          kind={quizKind}
          quiz={quiz}
          current={current}
          answers={answers}
          secondsLeft={secondsLeft}
          setCurrent={setCurrent}
          setAnswers={setAnswers}
          finishQuiz={finishQuiz}
          goHome={goHome}
          syncState={syncState}
          signedIn={Boolean(user)}
          reportQuestion={(question) => openFeedback({ origin: `quiz:${quizKind}`, questionId: question.id, prompt: question.prompt, source: question.source })}
        />
      )}
      {view === "results" && (
        <Results
          score={score}
          total={quiz.length}
          quiz={quiz}
          answers={lastAnswers}
          missedTopics={missedTopics}
          startQuiz={startQuiz}
          setView={showView}
          goHome={goHome}
          reportQuestion={(question) => openFeedback({ origin: "results", questionId: question.id, prompt: question.prompt, source: question.source })}
        />
      )}
      {view === "flashcards" && (
        <Flashcards
          cards={cardDeck}
          index={cardIndex}
          open={cardOpen}
          setIndex={(index) => { setCardIndex(index); setCardOpen(false); }}
          setOpen={setCardOpen}
          startQuiz={startQuiz}
          shuffleDeck={() => { setCardDeck(shuffle(flashcards)); setCardIndex(0); setCardOpen(false); }}
          reportCard={(prompt, source) => openFeedback({ origin: "flashcard", prompt, source })}
        />
      )}
      {view === "sources" && <Sources startQuiz={startQuiz} />}
    </main>
  );
}

function FeedbackPanel({ target, user, kind, setKind, message, setMessage, busy, sent, error, close, submit, signIn }: {
  target: FeedbackTarget; user: User | null; kind: FeedbackKind; setKind: (kind: FeedbackKind) => void; message: string; setMessage: (message: string) => void;
  busy: boolean; sent: boolean; error: string; close: () => void; submit: (event: React.FormEvent) => void; signIn: () => void;
}) {
  const options: { value: FeedbackKind; label: string }[] = [
    { value: "content_error", label: "Possible error" },
    { value: "unclear", label: "Unclear wording" },
    { value: "source_question", label: "Source question" },
    { value: "feature_idea", label: "Study-tool idea" },
    { value: "technical", label: "Technical problem" },
  ];
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="feedback-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-title">
      <button className="modal-close" onClick={close} aria-label="Close">×</button>
      {sent ? <div className="feedback-success"><b>✓</b><span className="eyebrow">FEEDBACK SAVED</span><h2 id="feedback-title">Thank you.</h2><p>Your note includes the study location and source context, so it can be reviewed efficiently.</p><button className="primary full-button" onClick={close}>Done</button></div> : <>
        <span className="eyebrow"><i /> HELP IMPROVE MASTER PREP</span>
        <h2 id="feedback-title">Tell us what needs attention.</h2>
        {target.prompt && <div className="feedback-context"><span>AUTOMATICALLY ATTACHED</span><strong>{target.prompt}</strong>{target.source && <small>{target.source}</small>}</div>}
        {!user ? <div className="feedback-signin"><p>Sign in first so the note is protected from spam and we can follow up if clarification is needed.</p><button className="primary full-button" onClick={signIn}>Sign in to send feedback →</button></div> : <form onSubmit={submit}>
          <fieldset><legend>What type of feedback is this?</legend><div className="feedback-types">{options.map((option) => <button key={option.value} type="button" className={kind === option.value ? "selected" : ""} onClick={() => setKind(option.value)}>{option.label}</button>)}</div></fieldset>
          <label htmlFor="feedback-message">What should we know?</label>
          <textarea id="feedback-message" required minLength={4} maxLength={1200} value={message} onChange={(event) => setMessage(event.target.value)} placeholder={target.prompt ? "Describe what seems wrong or unclear…" : "Share an idea, content concern, or technical problem…"} />
          {error && <p className="feedback-error" role="alert">{error}</p>}
          <div className="feedback-submit"><small>Sent from {user.email}</small><button className="primary" disabled={busy || message.trim().length < 4}>{busy ? "Sending…" : "Send feedback →"}</button></div>
        </form>}
      </>}
    </section>
  </div>;
}

function AccountPanel({ user, email, setEmail, message, busy, configured, attempts, close, submit, signOut }: {
  user: User | null; email: string; setEmail: (value: string) => void; message: string; busy: boolean; configured: boolean; attempts: Attempt[];
  close: () => void; submit: (event: React.FormEvent) => void; signOut: () => void;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
    <section className="account-panel" role="dialog" aria-modal="true" aria-labelledby="account-title">
      <button className="modal-close" onClick={close} aria-label="Close">×</button>
      {user ? <>
        <span className="eyebrow"><i /> PRIVATE STUDY ACCOUNT</span>
        <h2 id="account-title">Your progress is synced.</h2>
        <p className="account-email">{user.email}</p>
        <div className="account-status"><b>✓</b><div><strong>Cross-device saving is on</strong><span>You can safely close this tab and continue on another device.</span></div></div>
        <h3>Recent exams</h3>
        <div className="attempt-list">{attempts.length ? attempts.map((attempt) => <div key={attempt.id}><span>{attempt.quiz_kind}</span><strong>{attempt.percent}%</strong><small>{new Date(attempt.completed_at).toLocaleDateString()}</small></div>) : <p>No completed exams yet.</p>}</div>
        <button className="secondary full-button" onClick={signOut}>Sign out</button>
      </> : <>
        <span className="eyebrow"><i /> SAVE ACROSS DEVICES</span>
        <h2 id="account-title">Sign in without a password.</h2>
        <p>Enter your email. Master Prep will send a secure link that keeps your scores and in-progress exams separate from every other firefighter.</p>
        <form onSubmit={submit}>
          <label htmlFor="account-email">Email address</label>
          <input id="account-email" type="email" inputMode="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" />
          <button className="primary full-button" disabled={busy || !configured}>{busy ? "Sending…" : "Email my sign-in link"}</button>
        </form>
        {!configured && <p className="setup-note">Account activation is in progress. Local device saving is already on.</p>}
        {message && <p className="auth-message" role="status">{message}</p>}
      </>}
    </section>
  </div>;
}

function Dashboard({ lastScore, startQuiz, setView, savedExam, resumeQuiz, user, openAccount, attempts }: {
  lastScore: number | null; startQuiz: (kind: QuizKind) => void; setView: (view: View) => void; savedExam: SavedExam | null; resumeQuiz: () => void;
  user: User | null; openAccount: () => void; attempts: Attempt[];
}) {
  const readiness = lastScore ?? 0;
  return (
    <div className="page dashboard">
      <section className="hero-grid">
        <div className="hero-copy">
          <span className="eyebrow"><i /> BUILT FOR THE TOP 10</span>
          <h1>Train for the score<br />that earns the interview.</h1>
          <p>Start with a fresh 25-question baseline drawn across every covered topic. Master Prep will identify weak areas and keep recent questions out of the next set.</p>
          <div className="hero-actions">
            <button className="primary" onClick={() => startQuiz("baseline")}>Build My Study Plan <span>→</span></button>
            <span className="microcopy">{canonicalQuestions.length} verified rules · {questions.length} question variations</span>
          </div>
        </div>
        <aside className="readiness-card">
          <div className="card-label">CURRENT READINESS</div>
          <div className="ring" style={{ "--score": `${readiness * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{lastScore === null ? "—" : `${lastScore}%`}</strong><span>{lastScore === null ? "Take baseline" : "Last score"}</span></div>
          </div>
          <p>{lastScore === null ? "Your first score becomes the benchmark—not a verdict." : readiness >= 88 ? "Strong benchmark. Shift toward timed mixed practice." : "Use the plan below your results to close the largest gaps first."}</p>
          <div className="coverage-mini"><span>Source coverage</span><strong>2 of 5 ready</strong></div>
        </aside>
      </section>

      <section className="save-strip">
        <div><span className={user ? "save-dot online" : "save-dot"} /><div><strong>{user ? "Signed in · progress sync is on" : "Protect your exam progress"}</strong><p>{user ? `${attempts.length} recent attempt${attempts.length === 1 ? "" : "s"} available on every device.` : "Sign in by email to continue on another phone or computer."}</p></div></div>
        <div>{savedExam && <button className="secondary" onClick={resumeQuiz}>Resume {savedExam.kind} · {Object.keys(savedExam.answers).length}/{savedExam.questionIds.length}</button>}<button className={savedExam ? "text-button" : "secondary"} onClick={openAccount}>{user ? "View my history" : "Set up my account"}</button></div>
      </section>

      <section className="section-block">
        <div className="section-heading"><div><span>TRAINING MODULES</span><h2>Your next best rep.</h2></div><p>Retrieval beats rereading. Use short, repeated sessions and revisit misses after a delay.</p></div>
        <div className="module-grid">
          <button className="module-card ember" onClick={() => setView("flashcards")}>
            <span className="module-icon">01</span><span className="tag">{flashcards.length} CARDS</span><h3>Flashcards</h3><p>Two recall angles for every rule, with a fresh shuffle whenever needed.</p><b>Start a deck →</b>
          </button>
          <button className="module-card cyan" onClick={() => startQuiz("practice")}>
            <span className="module-icon">02</span><span className="tag">10 QUESTIONS</span><h3>Practice Set</h3><p>Ten fresh questions from the full variation pool, with recent rules held back.</p><b>Practice now →</b>
          </button>
          <button className="module-card green" onClick={() => startQuiz("timed")}>
            <span className="module-icon">03</span><span className="tag">25 QUESTIONS · 25 MIN</span><h3>Timed Exam</h3><p>A fresh full-length rehearsal from the same 290-variation pool. The timer is a training target, not an official limit.</p><b>Start timed exam →</b>
          </button>
        </div>
      </section>

      <section className="strategy-grid">
        <div className="strategy-card">
          <span className="eyebrow"><i /> RECOMMENDED LOOP</span>
          <h2>Diagnose. Drill. Retest.</h2>
          <ol>
            <li><strong>Baseline</strong><span>Take 25 questions without notes.</span></li>
            <li><strong>Target</strong><span>Study the two weakest topic areas first.</span></li>
            <li><strong>Retrieve</strong><span>Use flashcards, then answer mixed questions.</span></li>
            <li><strong>Retest</strong><span>Wait, then repeat under a training timer.</span></li>
          </ol>
        </div>
        <div className="source-alert">
          <span>IMPORTANT COVERAGE NOTE</span>
          <h3>This tool does not replace the full reading list.</h3>
          <p>Questions here are grounded in the two supplied KFD articles. Three IFSTA books remain required study sources and were not provided.</p>
          <button onClick={() => setView("sources")}>Review all five sources →</button>
        </div>
      </section>
    </div>
  );
}

function QuizScreen({ kind, quiz, current, answers, secondsLeft, setCurrent, setAnswers, finishQuiz, goHome, syncState, signedIn, reportQuestion }: {
  kind: QuizKind; quiz: Question[]; current: number; answers: Record<number, number>; secondsLeft: number;
  setCurrent: (index: number) => void; setAnswers: React.Dispatch<React.SetStateAction<Record<number, number>>>; finishQuiz: () => void; goHome: () => void;
  syncState: "local" | "syncing" | "saved"; signedIn: boolean;
  reportQuestion: (question: Question) => void;
}) {
  const question = quiz[current];
  const answered = Object.keys(answers).length;
  const minutes = Math.floor(secondsLeft / 60).toString().padStart(2, "0");
  const seconds = (secondsLeft % 60).toString().padStart(2, "0");
  return (
    <div className="page quiz-page">
      <div className="quiz-toolbar">
        <button className="text-button" onClick={goHome}>← Exit</button>
        <div><span>{kind === "baseline" ? "BASELINE EXAM" : kind === "timed" ? "TIMED PRACTICE" : "PRACTICE SET"}</span><strong>Question {current + 1} of {quiz.length}</strong></div>
        <div className={kind === "timed" && secondsLeft < 300 ? "timer danger" : "timer"}>{kind === "timed" ? `${minutes}:${seconds}` : `${answered}/${quiz.length} answered`}</div>
      </div>
      <div className="progress-track"><span style={{ width: `${((current + 1) / quiz.length) * 100}%` }} /></div>
      <section className="question-card">
        <div className="question-meta"><span>{question.topic}</span><small>{question.source}</small></div>
        <h1>{question.prompt}</h1>
        <div className="answers" role="radiogroup" aria-label="Answer choices">
          {question.options.map((option, index) => (
            <button
              key={option}
              role="radio"
              aria-checked={answers[question.id] === index}
              className={answers[question.id] === index ? "selected" : ""}
              onClick={() => setAnswers((value) => ({ ...value, [question.id]: index }))}
            ><span>{String.fromCharCode(65 + index)}</span>{option}</button>
          ))}
        </div>
        <div className="quiz-nav">
          <button className="secondary" disabled={current === 0} onClick={() => setCurrent(current - 1)}>Previous</button>
          {current < quiz.length - 1 ? (
            <button className="primary" disabled={answers[question.id] === undefined} onClick={() => setCurrent(current + 1)}>Next question →</button>
          ) : (
            <button className="primary" onClick={finishQuiz}>Finish & build plan →</button>
          )}
        </div>
        <button className="report-link" onClick={() => reportQuestion(question)}>Flag this question for review</button>
      </section>
      <p className="quiz-note">{signedIn ? syncState === "saved" ? "✓ Progress saved to your account" : syncState === "syncing" ? "Saving progress…" : "Saved on this device" : "Saved on this device · sign in from the dashboard for cross-device access"} · Explanations appear after submission.</p>
    </div>
  );
}

function Results({ score, total, quiz, answers, missedTopics, startQuiz, setView, goHome, reportQuestion }: {
  score: number; total: number; quiz: Question[]; answers: Record<number, number>; missedTopics: [Topic, number][];
  startQuiz: (kind: QuizKind) => void; setView: (view: View) => void; goHome: () => void;
  reportQuestion: (question: Question) => void;
}) {
  const percent = Math.round((score / total) * 100);
  const missed = quiz.filter((question) => answers[question.id] !== question.answer);
  return (
    <div className="page results-page">
      <section className="result-hero">
        <div><span className="eyebrow"><i /> STUDY PLAN READY</span><h1>{score} of {total} correct.</h1><p>This is a training benchmark, not a predicted rank. Your highest-value work is in the misses below.</p></div>
        <div className="score-box"><strong>{percent}%</strong><span>{percent >= 88 ? "Strong benchmark" : percent >= 72 ? "Build consistency" : "Start with foundations"}</span></div>
      </section>
      <section className="plan-grid">
        <div className="plan-card">
          <span>YOUR NEXT THREE MOVES</span>
          <ol>
            <li><b>1</b><div><strong>Review {missedTopics[0]?.[0] ?? "mixed topics"}</strong><small>{missedTopics[0]?.[1] ?? 0} missed question(s)</small></div></li>
            <li><b>2</b><div><strong>Run the flashcard deck</strong><small>Say the answer before revealing it</small></div></li>
            <li><b>3</b><div><strong>Retake a mixed set tomorrow</strong><small>Spacing makes the learning durable</small></div></li>
          </ol>
          <div className="inline-actions"><button className="primary" onClick={() => setView("flashcards")}>Start flashcards →</button><button className="secondary" onClick={() => startQuiz("practice")}>New practice set</button></div>
        </div>
        <div className="topic-card"><span>TOPIC BREAKDOWN</span>{missedTopics.length ? missedTopics.map(([topic, count]) => <div key={topic}><p><strong>{topic}</strong><small>{count} missed</small></p><div><i style={{ width: `${Math.min(100, count * 28)}%` }} /></div></div>) : <p className="perfect">No misses. Retest later to confirm retention.</p>}</div>
      </section>
      <section className="review-section">
        <div className="section-heading"><div><span>REVIEW THE MISSES</span><h2>Turn errors into anchors.</h2></div><button className="text-button" onClick={goHome}>Back to dashboard →</button></div>
        {missed.length === 0 ? <div className="empty-state">Perfect set. Space the next attempt instead of immediately repeating it.</div> : missed.map((question) => (
          <article className="review-card" key={question.id}>
            <div><span>{question.topic}</span><small>{question.source}</small></div>
            <h3>{question.prompt}</h3>
            <p className="your-answer">Your answer: {answers[question.id] === undefined ? "No answer" : question.options[answers[question.id]]}</p>
            <p className="correct-answer">Correct: {question.options[question.answer]}</p>
            <p>{question.explanation}</p>
            <button className="report-link" onClick={() => reportQuestion(question)}>Flag this question for review</button>
          </article>
        ))}
      </section>
    </div>
  );
}

function Flashcards({ cards, index, open, setIndex, setOpen, startQuiz, shuffleDeck, reportCard }: { cards: Flashcard[]; index: number; open: boolean; setIndex: (index: number) => void; setOpen: (open: boolean) => void; startQuiz: (kind: QuizKind) => void; shuffleDeck: () => void; reportCard: (prompt: string, source: string) => void }) {
  const card = cards[index] ?? cards[0];
  return (
    <div className="page cards-page">
      <div className="page-title"><span className="eyebrow"><i /> {cards.length}-CARD ACTIVE RECALL BANK</span><h1>Flashcards</h1><p>Each tested rule appears from two angles. Say the full answer before revealing it, then shuffle whenever the order starts to feel familiar.</p><button className="secondary deck-shuffle" onClick={shuffleDeck}>Shuffle all cards ↻</button></div>
      <button className={`flashcard ${open ? "open" : ""}`} onClick={() => setOpen(!open)} aria-label={open ? "Hide answer" : "Reveal answer"}>
        <div className="flashcard-top"><span>{index + 1} / {cards.length}</span><small>{card[2]}</small></div>
        <div className="flashcard-content"><span>{open ? "ANSWER" : "PROMPT"}</span><h2>{open ? card[1] : card[0]}</h2><p>{open ? "Tap to return to the prompt" : "Commit to an answer, then tap to reveal"}</p></div>
      </button>
      <div className="card-controls"><button className="secondary" onClick={() => setIndex((index - 1 + cards.length) % cards.length)}>← Previous</button><button className="primary" onClick={() => setIndex((index + 1) % cards.length)}>Next card →</button></div>
      <button className="report-link card-report" onClick={() => reportCard(card[0], card[2])}>Flag this flashcard for review</button>
      <div className="cards-finish"><p>Ready to test recognition under pressure?</p><button onClick={() => startQuiz("practice")}>Take a 10-question set →</button></div>
    </div>
  );
}

function Sources({ startQuiz }: { startQuiz: (kind: QuizKind) => void }) {
  return (
    <div className="page sources-page">
      <div className="page-title"><span className="eyebrow"><i /> DECEMBER 2025 READING LIST</span><h1>Know what is—and isn’t—covered.</h1><p>Master Prep currently generates study content only from the two supplied KFD articles. Use the official IFSTA books for the remaining tested material.</p></div>
      <div className="source-list">
        {sourceCoverage.map((source, index) => <article key={source.title}><span>{String(index + 1).padStart(2, "0")}</span><div><h2>{source.title}</h2><p>{source.detail}</p></div><b className={source.tone}>{source.status}</b></article>)}
      </div>
      <section className="source-guidance"><div><span>USE THE OFFICIAL EDITIONS</span><h2>Bring the missing sources into the study loop.</h2><p>The reading list identifies station/division copies and reference copies at the Lawson McGhee Library. Master Prep should not invent questions from books it cannot inspect.</p></div><button className="primary" onClick={() => startQuiz("baseline")}>Start covered baseline →</button></section>
      <p className="source-footnote">Article 4 coverage follows the reading-list exclusion of Sections 4.5.7 and 4.5.10. Always resolve any conflict in favor of the current official KFD source.</p>
    </div>
  );
}
