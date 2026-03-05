import { useEffect, useRef, useCallback, useState } from "react";

const API_KEY  = import.meta.env.VITE_SHEETS_API_KEY;
const SHEET_ID = import.meta.env.VITE_SHEET_ID;
const RANGE    = "Sheet1!A1";
const DEBOUNCE = 1500;

export function useGoogleSheets(scenarios, setScenarios) {
  const [status, setStatus]   = useState("idle");
  const [error, setError]     = useState(null);
  const saveTimer             = useRef(null);
  const lastSaved             = useRef(null);
  const initialLoadDone       = useRef(false);

  const configured = !!(API_KEY && SHEET_ID &&
    API_KEY !== "YOUR_API_KEY" && SHEET_ID !== "YOUR_SHEET_ID");

  const loadFromSheet = useCallback(async () => {
    if (!configured) { setStatus("unconfigured"); return; }
    setStatus("loading");
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const raw = data.values?.[0]?.[0];
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) setScenarios(parsed);
      }
      setStatus("saved");
      initialLoadDone.current = true;
    } catch (e) {
      console.error("Sheets load error:", e);
      setError(e.message);
      setStatus("error");
      initialLoadDone.current = true;
    }
  }, [configured, setScenarios]);

  const saveToSheet = useCallback(async (data) => {
    if (!configured) return;
    const json = JSON.stringify(data);
    if (json === lastSaved.current) return;
    setStatus("saving");
    try {
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?valueInputOption=RAW&key=${API_KEY}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ range: RANGE, majorDimension: "ROWS", values: [[json]] }),
      });
      if (!res.ok) throw new Error(`Sheets API ${res.status}: ${await res.text()}`);
      lastSaved.current = json;
      setStatus("saved");
      setError(null);
    } catch (e) {
      console.error("Sheets save error:", e);
      setError(e.message);
      setStatus("error");
    }
  }, [configured]);

  // debounced auto-save
  useEffect(() => {
    if (!initialLoadDone.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveToSheet(scenarios), DEBOUNCE);
    return () => clearTimeout(saveTimer.current);
  }, [scenarios, saveToSheet]);

  // initial load
  useEffect(() => { loadFromSheet(); }, [loadFromSheet]);

  return { status, error, configured, reload: loadFromSheet };
}
