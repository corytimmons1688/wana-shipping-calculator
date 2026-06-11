// useActuals.js
// Syncs the shared "actuals" object (inbound/outbound shipments, PO lines,
// adjustments, targets, milestones) to a single Supabase row (actuals, id=1).
// Facts shared across all scenarios — same anon REST pattern as useSupabase,
// separate table + debounce timer so the two hooks never conflict.

import { useEffect, useRef, useCallback, useState } from "react";

const SUPABASE_URL = "https://fxdyiurjioesdmedmgzu.supabase.co";
const ANON_KEY     = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ4ZHlpdXJqaW9lc2RtZWRtZ3p1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MzIzOTYsImV4cCI6MjA4ODMwODM5Nn0.5ueK5iXQ35oThb02ClX3iErPwYR4tPih9GtBAmhDQYk";
const HEADERS      = { "Content-Type": "application/json", "apikey": ANON_KEY, "Authorization": `Bearer ${ANON_KEY}` };
const ROW_URL      = `${SUPABASE_URL}/rest/v1/actuals?id=eq.1`;
const TABLE_URL    = `${SUPABASE_URL}/rest/v1/actuals`;
const DEBOUNCE_MS  = 1500;

// Structural migrations — default any missing keys so older rows stay loadable.
function migrate(d) {
  if (!d || typeof d !== "object") d = {};
  for (const k of ["inbound", "outbound", "poLines", "adjustments", "milestones"])
    if (!Array.isArray(d[k])) d[k] = [];
  if (!d.targets || typeof d.targets !== "object") d.targets = {};
  if (d.targets.ropMonths == null) d.targets.ropMonths = 5.5;
  if (d.targets.maxMonths == null) d.targets.maxMonths = 8.5;
  if (!Array.isArray(d.targets.rows)) d.targets.rows = [];
  for (const sh of d.inbound) {
    if (sh.id == null) sh.id = Date.now() + Math.random();
    if (sh.received == null) sh.received = false;
    if (!Array.isArray(sh.lines)) sh.lines = [];
  }
  for (const sh of d.outbound) {
    if (sh.id == null) sh.id = Date.now() + Math.random();
    if (sh.delivered == null) sh.delivered = false;
    if (!Array.isArray(sh.lines)) sh.lines = [];
  }
  return d;
}

export function useActuals(actuals, setActuals) {
  const [status, setStatus] = useState("idle");
  const [error, setError]   = useState(null);
  const saveTimer           = useRef(null);
  const lastSaved           = useRef(null);
  const initialLoadDone     = useRef(false);

  // ── WRITE ─────────────────────────────────────────────────────────────────
  const saveToDB = useCallback(async (data) => {
    const json = JSON.stringify(data);
    if (json === lastSaved.current) return;
    setStatus("saving");
    try {
      const res = await fetch(ROW_URL, {
        method: "PATCH",
        headers: { ...HEADERS, "Prefer": "return=minimal" },
        body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      lastSaved.current = json;
      setStatus("saved");
      setError(null);
    } catch (e) {
      console.error("Actuals save error:", e);
      setError(e.message);
      setStatus("error");
    }
  }, []);

  // ── READ ──────────────────────────────────────────────────────────────────
  const loadFromDB = useCallback(async (currentActuals) => {
    setStatus("loading");
    try {
      const res = await fetch(ROW_URL, { headers: HEADERS });
      if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      if (rows.length > 0) {
        const loaded = migrate(rows[0].data);
        lastSaved.current = JSON.stringify(loaded);
        setActuals(loaded);
        setStatus("saved");
      } else {
        // Row missing (table just created) — insert it with current state.
        const ins = await fetch(TABLE_URL, {
          method: "POST",
          headers: { ...HEADERS, "Prefer": "return=minimal" },
          body: JSON.stringify({ id: 1, data: currentActuals }),
        });
        if (!ins.ok) throw new Error(`Supabase ${ins.status}: ${await ins.text()}`);
        lastSaved.current = JSON.stringify(currentActuals);
        setStatus("saved");
      }
      initialLoadDone.current = true;
    } catch (e) {
      console.error("Actuals load error:", e);
      setError(e.message);
      setStatus("error");
      initialLoadDone.current = true;
    }
  }, [setActuals]);

  // ── AUTO-SAVE (debounced) ─────────────────────────────────────────────────
  useEffect(() => {
    if (!initialLoadDone.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToDB(actuals), DEBOUNCE_MS);
    return () => clearTimeout(saveTimer.current);
  }, [actuals, saveToDB]);

  // ── INITIAL LOAD ──────────────────────────────────────────────────────────
  useEffect(() => { loadFromDB(actuals); }, []); // eslint-disable-line

  return { status, error, reload: () => loadFromDB(actuals) };
}
