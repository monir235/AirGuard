import { useEffect, useRef, useState } from "react";
import Suggestion from "./suggestions";

const DEBOUNCE_MS = 1500; // wait for sensor values to settle
const MIN_REFRESH_MS = 30000; // don't re-ask Gemini more than every 30s for the same stage
const REQUEST_TIMEOUT_MS = 15000; // give up after 15s and use rule-based advice

/**
 * Shows Gemini AI advice for the current risk stage.
 * If Gemini is loading, fails, times out, or returns nothing,
 * the existing rule-based <Suggestion /> is shown instead.
 */
export default function GeminiAdvice({ riskClass, readings }) {
  const [advice, setAdvice] = useState("");
  const [status, setStatus] = useState("idle"); // idle | loading | ready | error
  const lastRequest = useRef({ risk: null, time: 0 });

  useEffect(() => {
    if (riskClass === null || riskClass === undefined) {
      setAdvice("");
      setStatus("idle");
      return;
    }

    // Stage changed -> old advice no longer applies.
    if (lastRequest.current.risk !== riskClass) {
      setAdvice("");
      setStatus("loading");
    } else if (Date.now() - lastRequest.current.time < MIN_REFRESH_MS) {
      return; // same stage, asked recently: keep current advice
    }

    const controller = new AbortController();
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, REQUEST_TIMEOUT_MS + DEBOUNCE_MS);

    const debounceId = setTimeout(async () => {
      lastRequest.current = { risk: riskClass, time: Date.now() };
      setStatus((s) => (s === "ready" ? s : "loading"));

      try {
        const response = await fetch("/api/gemini-advice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ riskClass, readings }),
        });

        const result = await response.json(); // throws if not JSON (e.g. dev server)
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        if (typeof result.advice !== "string" || !result.advice.trim()) {
          throw new Error("Empty advice");
        }

        setAdvice(result.advice.trim());
        setStatus("ready");
      } catch (error) {
        if (error.name === "AbortError" && !timedOut) return; // cleanup abort
        console.warn("Gemini unavailable, using rule-based advice:", error);
        setAdvice("");
        setStatus("error");
      } finally {
        clearTimeout(timeoutId);
      }
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(debounceId);
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    riskClass,
    readings.dust,
    readings.gas,
    readings.humidity,
    readings.temperature,
  ]);

  // Gemini worked: show AI advice.
  if (status === "ready" && advice) {
    return (
      <>
        <div className="ag-ai-heading">
          <span className="ag-ai-sparkle">✦</span>
          <span>AirGuard Assistant</span>
          <span className="ag-source-badge">GEMINI AI</span>
        </div>
        <article className="ag-ai-card">
          <h2>Personalized Suggestions</h2>
          <p style={{ whiteSpace: "pre-line" }}>{advice}</p>
          <p className="ag-safety-note">
            AI-generated guidance. It is not medical advice; follow your
            personal asthma action plan.
          </p>
        </article>
      </>
    );
  }

  // Gemini loading, failed, or idle: rule-based advice continues as before.
  return (
    <>
      <div className="ag-ai-heading">
        <span className="ag-ai-sparkle">✦</span>
        <span>AirGuard Assistant</span>
        <span className="ag-source-badge">
          {status === "loading" ? "RULE-BASED · AI LOADING…" : "RULE-BASED GUIDANCE"}
        </span>
      </div>
      <Suggestion riskClass={riskClass} readings={readings} />
    </>
  );
}