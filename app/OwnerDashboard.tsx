"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "./supabase";

type Profile = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  last_seen_at: string | null;
};

type OwnerAttempt = {
  id: string;
  user_id: string;
  quiz_kind: "baseline" | "practice" | "timed";
  score: number;
  total: number;
  percent: number;
  missed_topics: unknown;
  completed_at: string;
};

type Progress = {
  user_id: string;
  active_exam: unknown;
  flashcard_index: number;
  updated_at: string;
};

type Feedback = {
  id: string;
  user_id: string;
  category: string;
  message: string;
  origin: string;
  content_prompt: string | null;
  source: string | null;
  status: "new" | "reviewing" | "resolved" | "declined";
  created_at: string;
};

type ActivityEvent = {
  id: string;
  user_id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type OwnerData = {
  profiles: Profile[];
  attempts: OwnerAttempt[];
  progress: Progress[];
  feedback: Feedback[];
  activity: ActivityEvent[];
};

const emptyData: OwnerData = { profiles: [], attempts: [], progress: [], feedback: [], activity: [] };
const sprintStart = new Date(2026, 6, 16);
const dayMs = 24 * 60 * 60 * 1000;
const localDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const relativeTime = (value: string | null) => {
  if (!value) return "No activity yet";
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 2) return "Just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const categoryLabel = (value: string) => ({
  content_error: "Possible error",
  unclear: "Unclear wording",
  source_question: "Source question",
  feature_idea: "Study-tool idea",
  technical: "Technical problem",
}[value] ?? value.replaceAll("_", " "));

const eventLabel = (value: string) => ({
  app_open: "Opened Master Prep",
  quiz_started: "Started a quiz",
  quiz_completed: "Completed a quiz",
  flashcards_opened: "Opened flashcards",
}[value] ?? value.replaceAll("_", " "));

export default function OwnerDashboard({ ownerId, isOwner, checkComplete, openAccount, goHome }: {
  ownerId: string | null;
  isOwner: boolean;
  checkComplete: boolean;
  openAccount: () => void;
  goHome: () => void;
}) {
  const [data, setData] = useState<OwnerData>(emptyData);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    if (!supabase || !ownerId || !isOwner) return;
    setLoading(true);
    setError("");
    const [profilesResult, attemptsResult, progressResult, feedbackResult, activityResult] = await Promise.all([
      supabase.from("profiles").select("user_id,email,display_name,created_at,last_seen_at").order("last_seen_at", { ascending: false, nullsFirst: false }),
      supabase.from("exam_attempts").select("id,user_id,quiz_kind,score,total,percent,missed_topics,completed_at").order("completed_at", { ascending: false }).limit(500),
      supabase.from("study_progress").select("user_id,active_exam,flashcard_index,updated_at"),
      supabase.from("feedback").select("id,user_id,category,message,origin,content_prompt,source,status,created_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("activity_events").select("id,user_id,event_type,metadata,created_at").order("created_at", { ascending: false }).limit(300),
    ]);
    const firstError = [profilesResult.error, attemptsResult.error, progressResult.error, feedbackResult.error, activityResult.error].find(Boolean);
    if (firstError) {
      setError("The private dashboard could not load yet. Please refresh after the owner access update is connected.");
    } else {
      setData({
        profiles: (profilesResult.data ?? []) as Profile[],
        attempts: (attemptsResult.data ?? []) as OwnerAttempt[],
        progress: (progressResult.data ?? []) as Progress[],
        feedback: (feedbackResult.data ?? []) as Feedback[],
        activity: (activityResult.data ?? []) as ActivityEvent[],
      });
      setUpdatedAt(new Date());
    }
    setLoading(false);
  }, [isOwner, ownerId]);

  useEffect(() => { void load(); }, [load]);

  const firefighters = useMemo(() => data.profiles.filter((profile) => profile.user_id !== ownerId), [data.profiles, ownerId]);
  const firefighterIds = useMemo(() => new Set(firefighters.map((profile) => profile.user_id)), [firefighters]);
  const sprintAttempts = useMemo(() => data.attempts.filter((attempt) => firefighterIds.has(attempt.user_id) && new Date(attempt.completed_at) >= sprintStart), [data.attempts, firefighterIds]);
  const activeNow = firefighters.filter((profile) => profile.last_seen_at && Date.now() - new Date(profile.last_seen_at).getTime() <= 48 * 60 * 60 * 1000).length;
  const openFeedback = data.feedback.filter((item) => firefighterIds.has(item.user_id) && item.status !== "resolved" && item.status !== "declined");

  const updateFeedback = async (id: string, status: Feedback["status"]) => {
    if (!supabase) return;
    const { error: updateError } = await supabase.from("feedback").update({ status }).eq("id", id);
    if (updateError) {
      setError("That feedback status could not be updated. Please try again.");
      return;
    }
    setData((current) => ({ ...current, feedback: current.feedback.map((item) => item.id === id ? { ...item, status } : item) }));
  };

  if (!ownerId) {
    return <div className="page owner-gate">
      <span className="eyebrow"><i /> PRIVATE OWNER AREA</span>
      <h1>Sign in to continue.</h1>
      <p>The Owner Dashboard is protected separately from the public study tools.</p>
      <div><button className="primary" onClick={openAccount}>Sign in by email →</button><button className="secondary" onClick={goHome}>Return to Master Prep</button></div>
    </div>;
  }

  if (!checkComplete) {
    return <div className="page owner-gate"><span className="owner-loader" /><h1>Checking owner access…</h1></div>;
  }

  if (!isOwner) {
    return <div className="page owner-gate">
      <span className="eyebrow"><i /> PRIVATE OWNER AREA</span>
      <h1>Owner access only.</h1>
      <p>This account cannot view other firefighters&apos; study records. Your own scores remain private.</p>
      <button className="secondary" onClick={goHome}>Return to my study dashboard</button>
    </div>;
  }

  return <div className="page owner-page">
    <section className="owner-heading">
      <div>
        <span className="eyebrow"><i /> PRIVATE · CHRISTINE ONLY</span>
        <h1>Owner Dashboard</h1>
        <p>See whether Master Prep is being opened, completed, and converted into stronger scores before July 29.</p>
      </div>
      <div className="owner-heading-actions">
        {updatedAt && <small>Updated {updatedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>}
        <button className="secondary" onClick={() => void load()} disabled={loading}>{loading ? "Refreshing…" : "Refresh data ↻"}</button>
      </div>
    </section>

    {error && <div className="owner-error" role="alert">{error}</div>}

    <section className="owner-metrics" aria-label="Study health summary">
      <article><span>FIREFIGHTERS</span><strong>{firefighters.length}</strong><p>Registered study accounts</p></article>
      <article><span>ACTIVE · 48 HOURS</span><strong>{activeNow}</strong><p>Successfully opened the app</p></article>
      <article><span>EXAM SPRINT</span><strong>{sprintAttempts.length}</strong><p>Completed attempts since July 16</p></article>
      <article><span>NEEDS REVIEW</span><strong>{openFeedback.length}</strong><p>Open feedback submissions</p></article>
    </section>

    <section className="owner-section">
      <div className="owner-section-heading"><div><span>INDIVIDUAL PROGRESS</span><h2>Are they studying—and improving?</h2></div><p>Exact scores stay inside this owner-only view.</p></div>
      <div className="firefighter-grid">
        {firefighters.length ? firefighters.map((profile, index) => <FirefighterCard key={profile.user_id} profile={profile} label={`Firefighter ${index + 1}`} attempts={data.attempts.filter((attempt) => attempt.user_id === profile.user_id)} progress={data.progress.find((item) => item.user_id === profile.user_id)} activity={data.activity.filter((event) => event.user_id === profile.user_id)} />) : <div className="owner-empty"><strong>No firefighter profiles are visible yet.</strong><p>Profiles appear after the owner access update is connected and signed-in users return to Master Prep.</p></div>}
      </div>
    </section>

    <section className="owner-section">
      <div className="owner-section-heading"><div><span>FEEDBACK INBOX</span><h2>What needs attention?</h2></div><p>{openFeedback.length} open item{openFeedback.length === 1 ? "" : "s"}</p></div>
      <div className="owner-feedback-list">
        {data.feedback.filter((item) => firefighterIds.has(item.user_id)).length ? data.feedback.filter((item) => firefighterIds.has(item.user_id)).map((item) => {
          const profile = firefighters.find((candidate) => candidate.user_id === item.user_id);
          return <article key={item.id} className={item.status === "resolved" ? "resolved" : ""}>
            <div className="owner-feedback-meta"><span>{categoryLabel(item.category)}</span><small>{profile?.display_name || profile?.email || "Firefighter"} · {relativeTime(item.created_at)}</small></div>
            <p>{item.message}</p>
            {(item.content_prompt || item.source) && <div className="owner-feedback-context">{item.content_prompt && <strong>{item.content_prompt}</strong>}{item.source && <small>{item.source}</small>}</div>}
            <div className="owner-feedback-actions"><span className={`status-pill ${item.status}`}>{item.status}</span>{item.status !== "reviewing" && item.status !== "resolved" && <button onClick={() => void updateFeedback(item.id, "reviewing")}>Mark reviewing</button>}{item.status !== "resolved" && <button onClick={() => void updateFeedback(item.id, "resolved")}>Resolve</button>}{item.status === "resolved" && <button onClick={() => void updateFeedback(item.id, "reviewing")}>Reopen</button>}</div>
          </article>;
        }) : <div className="owner-empty"><strong>No feedback submitted.</strong><p>New notes will appear here and continue to be emailed to you.</p></div>}
      </div>
    </section>

    <p className="owner-privacy-note">Private by design: firefighters can access only their own records. The owner role is enforced by Supabase, not by hiding this page address.</p>
  </div>;
}

function FirefighterCard({ profile, label, attempts, progress, activity }: {
  profile: Profile;
  label: string;
  attempts: OwnerAttempt[];
  progress?: Progress;
  activity: ActivityEvent[];
}) {
  const baselines = attempts.filter((attempt) => attempt.quiz_kind === "baseline");
  const timed = attempts.filter((attempt) => attempt.quiz_kind === "timed");
  const practice = attempts.filter((attempt) => attempt.quiz_kind === "practice");
  const latestBaseline = baselines[0];
  const firstBaseline = baselines.at(-1);
  const improvement = latestBaseline && firstBaseline ? latestBaseline.percent - firstBaseline.percent : null;
  const timedAverage = timed.length ? Math.round(timed.slice(0, 3).reduce((sum, attempt) => sum + attempt.percent, 0) / Math.min(3, timed.length)) : null;
  const activeDays = new Set(attempts.map((attempt) => localDateKey(new Date(attempt.completed_at)))).size;
  const weakTopics = new Map<string, number>();
  attempts.slice(0, 8).forEach((attempt) => {
    if (!Array.isArray(attempt.missed_topics)) return;
    attempt.missed_topics.forEach((topic) => {
      if (typeof topic === "string") weakTopics.set(topic, (weakTopics.get(topic) ?? 0) + 1);
    });
  });
  const weakest = [...weakTopics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const activeExam = progress?.active_exam && typeof progress.active_exam === "object" ? progress.active_exam as { kind?: string; answers?: Record<string, number>; questionIds?: number[] } : null;
  const lastSeenTime = profile.last_seen_at ? new Date(profile.last_seen_at).getTime() : 0;
  const quietDays = lastSeenTime ? Math.floor((Date.now() - lastSeenTime) / dayMs) : 99;
  const health = quietDays <= 1 ? { label: "Active", tone: "good" } : quietDays <= 3 ? { label: "Check in", tone: "watch" } : { label: "Quiet", tone: "quiet" };
  const latestEvent = activity[0];

  return <article className="firefighter-card">
    <div className="firefighter-card-top">
      <div className="firefighter-identity"><span>{label}</span><strong>{profile.display_name || profile.email || "Signed-in user"}</strong><small>Last active {relativeTime(profile.last_seen_at)}</small></div>
      <span className={`health-pill ${health.tone}`}><i /> {health.label}</span>
    </div>
    <div className="firefighter-score-grid">
      <div><span>BASELINE</span><strong>{latestBaseline ? `${latestBaseline.percent}%` : "—"}</strong><small>{improvement === null ? "No comparison yet" : `${improvement >= 0 ? "+" : ""}${improvement} points`}</small></div>
      <div><span>TIMED AVG.</span><strong>{timedAverage === null ? "—" : `${timedAverage}%`}</strong><small>Last {Math.min(3, timed.length) || 0} attempt{timed.length === 1 ? "" : "s"}</small></div>
      <div><span>ACTIVE DAYS</span><strong>{activeDays}</strong><small>{attempts.length} completed sets</small></div>
    </div>
    <div className="attempt-mix"><span><i style={{ width: `${attempts.length ? baselines.length / attempts.length * 100 : 0}%` }} />Baseline {baselines.length}</span><span><i style={{ width: `${attempts.length ? practice.length / attempts.length * 100 : 0}%` }} />Practice {practice.length}</span><span><i style={{ width: `${attempts.length ? timed.length / attempts.length * 100 : 0}%` }} />Timed {timed.length}</span></div>
    <div className="firefighter-detail-row"><div><span>REPEATED GAPS</span><strong>{weakest.length ? weakest.map(([topic]) => topic).join(" · ") : "Not enough misses yet"}</strong></div><div><span>CURRENT STATE</span><strong>{activeExam ? `${activeExam.kind ?? "Exam"} in progress · ${Object.keys(activeExam.answers ?? {}).length}/${activeExam.questionIds?.length ?? "?"}` : latestEvent ? eventLabel(latestEvent.event_type) : "No current exam"}</strong></div></div>
    {attempts.length > 0 && <div className="score-sparkline" aria-label="Recent score history">{attempts.slice(0, 10).reverse().map((attempt) => <span key={attempt.id} title={`${attempt.quiz_kind}: ${attempt.percent}%`} style={{ height: `${Math.max(12, attempt.percent)}%` }} />)}</div>}
  </article>;
}
