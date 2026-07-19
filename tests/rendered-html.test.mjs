import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the Master Prep study dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Master Prep \| KFD Promotional Study<\/title>/i);
  assert.match(html, /277(?:<!-- -->)? verified rules/i);
  assert.match(html, /554(?:<!-- -->)? question variations/i);
  assert.match(html, /554(?:<!-- -->)? CARDS/i);
  assert.match(html, /50 source-balanced questions/i);
  assert.match(html, /Review all five sources/i);
  assert.match(html, /Protect your exam progress/i);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/i);
});

test("keeps exam variation and flashcard depth in the product source", async () => {
  const [page, data] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/studyData.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /buildBalancedQuiz/);
  assert.match(page, /selectedRules/);
  assert.match(page, /kind === "baseline" \? 50/);
  assert.match(page, /balanceBy: "topic" \| "source"/);
  assert.match(page, /master-prep-recent-questions/);
  assert.match(page, /setCardDeck\(shuffle\(flashcards\)\)/);
  assert.match(data, /canonicalQuestions\.flatMap/);
  assert.match(data, /applicationQuestions/);
  assert.match(data, /Article 4 §4\.3\.7/);
  assert.match(data, /Article 3 §3\.12\.5/);
});

test("keeps the owner dashboard protected and activity-aware", async () => {
  const [page, owner, migration] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/OwnerDashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/owner-dashboard.sql", import.meta.url), "utf8"),
  ]);

  assert.match(page, /app_admins/);
  assert.match(page, /isOwner && <button/);
  assert.match(owner, /Owner access only/);
  assert.match(owner, /PRIVATE · CHRISTINE ONLY/);
  assert.match(owner, /Repeated gaps/i);
  assert.match(migration, /is_app_admin/);
  assert.match(migration, /activity_select_admin/);
  assert.match(migration, /christinesmith\.colibri@gmail\.com/);
  assert.doesNotMatch(page, /service_role|sb_secret_/i);
});
