import { useEffect, useState } from "react";
import GeminiAdvice from "./Gemini";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import * as tflite from "@tensorflow/tfjs-tflite";
import { initializeApp, getApps, getApp } from "firebase/app";
import { getDatabase, ref, onValue } from "firebase/database";
import "./home.css";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAwfpDR6izGY1CYb2KPZ7E-jBwY-CfZEJ4",
  appId: "1:730388425018:web:1f7edb0069c2f7dec6c803",
  messagingSenderId: "730388425018",
  projectId: "espair-e380b",
  databaseURL:
    "https://espair-e380b-default-rtdb.asia-southeast1.firebasedatabase.app",
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const database = getDatabase(app);

const initialReadings = {
  dust: null,
  gas: null,
  humidity: null,
  temperature: null,
};

const SENSORS = [
  { key: "dust", label: "Dust", unit: "µg/m³", icon: "✳", color: "#FFAA33", max: 300 },
  { key: "gas", label: "Gas", unit: "Raw ADC", icon: "♧", color: "#BB5CF6", max: 4095 },
  { key: "humidity", label: "Humidity", unit: "%", icon: "♧", color: "#38B2FF", max: 100 },
  { key: "temperature", label: "Temperature", unit: "°C", icon: "♨", color: "#FF5F7E", max: 50 },
];

const RISK_INFO = [
  {
    label: "SAFE",
    color: "#00E5A0",
    headline: "Environmental Monitoring",
    description:
      "The model classified this sensor sample as Safe. Continue monitoring environmental conditions and follow your usual asthma care plan.",
  },
  {
    label: "MODERATE RISK",
    color: "#FFAA33",
    headline: "Precautionary Monitoring",
    description:
      "The model classified this sample as Moderate Risk. Review the environment for possible triggers and follow your personal asthma action plan.",
  },
  {
    label: "HIGH RISK",
    color: "#FF3D5E",
    headline: "Increased Attention Required",
    description:
      "The model classified this sample as High Risk. Reduce exposure to suspected environmental triggers and follow your personal asthma action plan.",
  },
];

export default function Home() {
  const [readings, setReadings] = useState(initialReadings);
  const [connection, setConnection] = useState("connecting");
  const [lastUpdated, setLastUpdated] = useState(null);

  // TFLite model state
  const [model, setModel] = useState(null);
  const [modelStatus, setModelStatus] = useState("loading");
  const [modelError, setModelError] = useState("");
  const [risk, setRisk] = useState(null);
  const [predictionUpdated, setPredictionUpdated] = useState(null);

  // Load the TFLite model once.
  useEffect(() => {
    let cancelled = false;

    async function loadModel() {
      try {
        await tf.setBackend("cpu");
        await tf.ready();

        // Explicit WASM path for the tfjs-tflite alpha runtime.
        if (typeof tflite.setWasmPath === "function") {
          tflite.setWasmPath(
            "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-tflite@0.0.1-alpha.9/dist/"
          );
        }

        const loadedModel = await tflite.loadTFLiteModel(
          "/models/trained_new_asthma_model.tflite"
        );

        if (!cancelled) {
          setModel(loadedModel);
          setModelStatus("ready");
          setModelError("");
        }
      } catch (error) {
        console.error("TFLite model loading failed:", error);
        if (!cancelled) {
          setModelStatus("error");
          setModelError(error?.message || "Could not load the TFLite model.");
        }
      }
    }

    loadModel();
    return () => {
      cancelled = true;
    };
  }, []);

  // Subscribe to live Firebase readings.
  useEffect(() => {
    const sensorRef = ref(database, "air_monitor");

    const unsubscribe = onValue(
      sensorRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setConnection("empty");
          setReadings(initialReadings);
          return;
        }

        const data = snapshot.val();
        const toNumberOrNull = (value) =>
          value != null && Number.isFinite(Number(value)) ? Number(value) : null;

        setReadings({
          dust: toNumberOrNull(data.dust),
          gas: toNumberOrNull(data.gas),
          humidity: toNumberOrNull(data.humidity),
          temperature: toNumberOrNull(data.temperature),
        });

        setConnection("connected");
        setLastUpdated(new Date());
      },
      (error) => {
        console.error("Firebase read failed:", error);
        setConnection("error");
      }
    );

    return () => unsubscribe();
  }, []);

  // Classify every complete set of live sensor values.
  useEffect(() => {
    if (!model) return;

    const values = [
      readings.dust,
      readings.gas,
      readings.humidity,
      readings.temperature,
    ];

    if (values.some((value) => value === null || !Number.isFinite(value))) {
      setRisk(null);
      return;
    }

    let cancelled = false;
    let inputTensor;
    let outputTensor;

    async function classify() {
      try {
        // Must match the preprocessing and feature order used during training.
        const means = [148.8126, 601.2853, 59.2403, 29.9679];
        const stds = [87.0211, 231.4084, 17.1156, 5.7025];
        const normalized = values.map(
          (value, index) => (value - means[index]) / stds[index]
        );

        inputTensor = tf.tensor2d([normalized], [1, 4], "float32");
        const prediction = model.predict(inputTensor);
        outputTensor = Array.isArray(prediction) ? prediction[0] : prediction;

        const scores = Array.from(await outputTensor.data());
        if (!scores.length || scores.some((score) => !Number.isFinite(score))) {
          throw new Error("The model returned invalid prediction scores.");
        }

        let predictedClass = 0;
        for (let i = 1; i < scores.length; i += 1) {
          if (scores[i] > scores[predictedClass]) predictedClass = i;
        }

        if (scores.length !== 3 || predictedClass > 2) {
          throw new Error(
            `Expected three class scores, but the model returned ${scores.length} output value(s).`
          );
        }

        if (!cancelled) {
          setRisk(predictedClass);
          setPredictionUpdated(new Date());
          setModelError("");
        }
      } catch (error) {
        console.error("TFLite inference failed:", error);
        if (!cancelled) {
          setModelError(error?.message || "Inference failed.");
          setRisk(null);
        }
      } finally {
        inputTensor?.dispose?.();
        outputTensor?.dispose?.();
      }
    }

    classify();
    return () => {
      cancelled = true;
    };
  }, [model, readings.dust, readings.gas, readings.humidity, readings.temperature]);

  const riskInfo =
    risk !== null && RISK_INFO[risk]
      ? RISK_INFO[risk]
      : {
          label: modelStatus === "loading" ? "LOADING MODEL" : "WAITING FOR DATA",
          color: "#38B2FF",
          headline: "Preparing Risk Classification",
          description:
            "Waiting for the model and all four valid Firebase sensor readings.",
        };

  const connectionInfo = {
    connecting: { label: "Connecting to Firebase…", color: "#FFAA33" },
    connected: { label: "Firebase Live", color: "#00E5A0" },
    empty: { label: "No Sensor Data", color: "#FFAA33" },
    error: { label: "Firebase Error", color: "#FF3D5E" },
  }[connection] || { label: "Firebase status unknown", color: "#FFAA33" };

  function formatValue(value, key) {
    if (value === null) return "--";
    if (key === "humidity" || key === "temperature") return value.toFixed(1);
    return value.toFixed(0);
  }

  return (
    <main className="airguard">
      <header className="ag-header">
        <div className="ag-brand">
          <div className="ag-logo">⌁</div>
          <div>
            <div className="ag-brand-name">AirGuard</div>
            <div className="ag-brand-subtitle">ASTHMA RISK MONITOR</div>
          </div>
        </div>

        <div className="ag-header-actions">
          <span
            className="ag-live-dot"
            style={{ background: connectionInfo.color }}
            title={connectionInfo.label}
          />
          <button
            className="ag-icon-button"
            onClick={() =>
              document.getElementById("ag-sensors")?.scrollIntoView({
                behavior: "smooth",
              })
            }
            aria-label="View sensor readings"
          >
            ↗
          </button>
        </div>
      </header>

      <div className="ag-content">
        <div className="ag-topline">
          <div className="ag-status-group">
            <span className="ag-pill ag-pill-blue">◈ Firebase RTDB</span>
            <span
              className="ag-pill"
              style={{
                color: connectionInfo.color,
                borderColor: `${connectionInfo.color}44`,
              }}
            >
              {connectionInfo.label}
            </span>
          </div>
        </div>

        <section
          className="ag-hero"
          style={{
            "--risk-color": riskInfo.color,
            "--risk-tint": `${riskInfo.color}1A`,
          }}
        >
          <div className="ag-hero-icon-wrap">
            <div className="ag-hero-icon">
              {risk === 0 ? "✓" : risk === 1 ? "⚠" : risk === 2 ? "!" : "…"}
            </div>
          </div>

          <div className="ag-hero-body">
            <div className="ag-risk-label">{riskInfo.label}</div>
            <h1>{riskInfo.headline}</h1>
            <p className="ag-demo-note">{riskInfo.description}</p>
            <p className="ag-demo-note">
              {predictionUpdated
                ? `Last model prediction: ${predictionUpdated.toLocaleTimeString()}`
                : lastUpdated
                  ? `Sensor data updated: ${lastUpdated.toLocaleTimeString()}`
                  : "Waiting for Firebase sensor readings"}
            </p>
          </div>
        </section>

        <div className="ag-section-heading" id="ag-sensors">
          <div>
            <h2>Environmental Sensors</h2>
            <p>Live values from Firebase Realtime Database</p>
          </div>
          <span className="ag-section-tag">4 SENSORS</span>
        </div>

        <section className="ag-sensor-grid">
          {SENSORS.map((sensor) => {
            const value = readings[sensor.key];
            const progress =
              value === null
                ? 0
                : Math.max(0, Math.min(100, (value / sensor.max) * 100));

            return (
              <article className="ag-sensor-card" key={sensor.key}>
                <div className="ag-sensor-top">
                  <span className="ag-sensor-icon" style={{ color: sensor.color }}>
                    {sensor.icon}
                  </span>
                  <span
                    className="ag-unit"
                    style={{
                      color: sensor.color,
                      background: `${sensor.color}16`,
                    }}
                  >
                    {sensor.unit}
                  </span>
                </div>

                <div className="ag-sensor-value">{formatValue(value, sensor.key)}</div>
                <div className="ag-sensor-label">{sensor.label}</div>
                <div className="ag-sensor-track">
                  <div
                    className="ag-sensor-progress"
                    style={{ width: `${progress}%`, background: sensor.color }}
                  />
                </div>
              </article>
            );
          })}
        </section>

        <section className="ag-panel">
          <div className="ag-panel-heading">
            <span className="ag-panel-icon">✦</span>
            <h2>Live ML Classification</h2>
          </div>

          <p className="ag-safety-note">
            {modelStatus === "ready"
              ? "TensorFlow Lite classifies each complete sensor sample received from Firebase."
              : modelStatus === "loading"
                ? "Loading the TensorFlow Lite model…"
                : "The model could not be loaded. Check the model path and browser console."}
          </p>

          <div className="ag-control-buttons">
            <span
              className="ag-pill"
              style={{
                color:
                  modelStatus === "ready"
                    ? "#00E5A0"
                    : modelStatus === "error"
                      ? "#FF3D5E"
                      : "#FFAA33",
                borderColor:
                  modelStatus === "ready"
                    ? "#00E5A044"
                    : modelStatus === "error"
                      ? "#FF3D5E44"
                      : "#FFAA3344",
              }}
            >
              {modelStatus === "ready"
                ? "MODEL READY"
                : modelStatus === "error"
                  ? "MODEL ERROR"
                  : "MODEL LOADING"}
            </span>

            {risk !== null && (
              <span className="ag-pill">
                Predicted class: {risk} ({riskInfo.label})
              </span>
            )}
          </div>

          {modelError && (
            <p className="ag-safety-note" role="alert" style={{ color: "#FF3D5E" }}>
              {modelError}
            </p>
          )}
        </section>

        {/* Gemini AI advice; falls back to the rule-based <Suggestion /> automatically */}
        <section className="Suggestion card">
          {risk !== null ? (
            <GeminiAdvice riskClass={risk} readings={readings} />
          ) : (
            <>
              <div className="ag-ai-heading">
                <span className="ag-ai-sparkle">✦</span>
                <span>AirGuard Assistant</span>
                <span className="ag-source-badge">RULE-BASED GUIDANCE</span>
              </div>
              <article className="ag-ai-card">
                <h2>Environmental Suggestions</h2>
                <p>Waiting for a valid model classification and sensor readings.</p>
              </article>
            </>
          )}
        </section>

        <footer className="ag-footer">
          <div className="ag-footer-brand">
            <span className="ag-footer-mark">⌁</span>
            <span>AirGuard</span>
          </div>
          <p>IoT-Based Asthma Risk Monitoring</p>
          <span className="ag-footer-status">
            <span className="ag-footer-dot" style={{ background: connectionInfo.color }} />
            {connectionInfo.label}
          </span>
        </footer>
      </div>
    </main>
  );
}