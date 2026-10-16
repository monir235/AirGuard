
import React, { useEffect, useState } from "react";
import "./suggestion.css";

// Provisional environmental thresholds for this prototype.
// Calibrate these against your actual sensors before deployment.
const RULES = {
  dust: {
    threshold: 300,
    title: "Dust level",
    advice:
      "The dust sensor reading is elevated. If possible, move away from dust, smoke, and airborne particles. Check the sensor and its calibration.",
  },
  gas: {
    threshold: 800,
    title: "Gas sensor",
    advice:
      "The gas sensor reading is elevated. Check for smoke, fumes, or strong odors and move to cleaner air if needed. The MQ-135 reading alone cannot identify a specific gas concentration.",
  },
  humidity: {
    low: 30,
    high: 70,
    title: "Humidity",
    advice:
      "Humidity is outside the app's configured range. Check for dampness, condensation, or mold and adjust ventilation when appropriate.",
  },
  temperature: {
    high: 32,
    title: "Temperature",
    advice:
      "The temperature is high. Consider moving to a cooler, comfortable environment and drinking water if appropriate.",
  },
};

// Six recommendations for each model classification.
const RISK_INFORMATION = {
  safe: {
    title: "SAFE",
    color: "#00e5a0",
    message:
      "The model classified this sample as Safe. Continue monitoring environmental conditions and follow your usual asthma care plan.",
    recommendations: [
      {
        title: "Continue monitoring",
        message:
          "Keep AirGuard running and observe changes in dust, gas, humidity, and temperature.",
      },
      {
        title: "Follow your asthma care plan",
        message:
          "Continue following your clinician's instructions, including prescribed medication and your personal asthma action plan.",
      },
      {
        title: "Keep indoor air clean",
        message:
          "Reduce exposure to smoke, strong fragrances, dust, and other irritants that may affect your breathing.",
      },
      {
        title: "Maintain a clean environment",
        message:
          "Clean surfaces regularly and reduce dust accumulation in your room, bedding, and frequently used areas.",
      },
      {
        title: "Check ventilation",
        message:
          "Maintain appropriate ventilation when outdoor air quality is suitable. Avoid bringing outdoor pollution indoors.",
      },
      {
        title: "Watch for symptoms",
        message:
          "Pay attention to coughing, wheezing, chest tightness, or shortness of breath even when the model reports Safe.",
      },
    ],
  },

  moderate: {
    title: "MODERATE RISK",
    color: "#ffaa33",
    message:
      "The model classified this sample as Moderate Risk. Review the current readings and consider reducing exposure to environmental irritants.",
    recommendations: [
      {
        title: "Reduce potential exposure",
        message:
          "Move away from visible dust, smoke, fumes, or other environmental irritants where possible.",
      },
      {
        title: "Recheck sensor readings",
        message:
          "Observe whether dust, gas, humidity, or temperature remains elevated. Confirm unusual readings with properly calibrated equipment.",
      },
      {
        title: "Improve indoor air conditions",
        message:
          "Use suitable ventilation or air filtration when appropriate and when the incoming air is cleaner than the indoor air.",
      },
      {
        title: "Avoid known asthma triggers",
        message:
          "Limit exposure to triggers that affect you personally, such as smoke, strong odors, cleaning sprays, or dust.",
      },
      {
        title: "Follow your action plan",
        message:
          "Follow your clinician-provided asthma action plan if symptoms develop. Use prescribed medicines only as directed.",
      },
      {
        title: "Monitor symptoms closely",
        message:
          "Watch for increasing cough, wheezing, chest tightness, or breathing difficulty. Seek medical help if symptoms worsen according to your action plan.",
      },
    ],
  },

  high: {
    title: "HIGH RISK",
    color: "#ff3d5e",
    message:
      "The model classified this sample as High Risk. Consider moving away from possible environmental triggers and follow your clinician-provided asthma action plan.",
    recommendations: [
      {
        title: "Move away from possible triggers",
        message:
          "If safe to do so, leave the area with suspected smoke, dust, fumes, or other irritants and move to cleaner air.",
      },
      {
        title: "Follow your asthma action plan",
        message:
          "Follow the steps your clinician has provided for worsening asthma symptoms, including prescribed reliever medication as directed.",
      },
      {
        title: "Check for symptoms immediately",
        message:
          "Pay attention to wheezing, persistent coughing, chest tightness, or shortness of breath. Do not rely on the model alone to judge your condition.",
      },
      {
        title: "Avoid further exposure",
        message:
          "Avoid the suspected trigger and do not re-enter an area with potentially hazardous fumes or smoke until it is safe.",
      },
      {
        title: "Get medical assistance when needed",
        message:
          "If symptoms are severe or rapidly worsening, seek emergency medical help. If breathing is severely difficult, do not wait for another sensor reading.",
      },
      {
        title: "Verify the environmental readings",
        message:
          "If it is safe, check the sensor values and device operation. A high model classification indicates a model result, not a confirmed medical emergency or measured pollutant concentration.",
      },
    ],
  },

  unknown: {
    title: "RISK UNKNOWN",
    color: "#94a3b8",
    message:
      "A valid risk classification is not available. Check the sensor readings and model output before relying on this assessment.",
    recommendations: [
      {
        title: "Check sensor connectivity",
        message:
          "Confirm that AirGuard is receiving current readings from Firebase.",
      },
      {
        title: "Verify all readings",
        message:
          "Check that dust, gas, humidity, and temperature values are present and within plausible sensor ranges.",
      },
      {
        title: "Check model loading",
        message:
          "Confirm that the TFLite model loaded successfully and that inference is returning a valid class.",
      },
      {
        title: "Inspect the device",
        message:
          "Check sensor wiring, power supply, and connections if readings are missing or unexpected.",
      },
      {
        title: "Avoid relying on an unknown result",
        message:
          "Use your own awareness of environmental conditions and follow your normal asthma care plan.",
      },
      {
        title: "Check for symptoms",
        message:
          "If breathing symptoms develop, follow your clinician's instructions regardless of the displayed model status.",
      },
    ],
  },
};

function getRiskLevel(riskClass) {
  if (typeof riskClass === "string") {
    const value = riskClass.toLowerCase();

    if (value.includes("high")) return "high";
    if (value.includes("moderate")) return "moderate";
    if (value.includes("safe")) return "safe";
  }

  if (
    riskClass === null ||
    riskClass === undefined ||
    riskClass === ""
  ) {
    return "unknown";
  }

  const value = Number(riskClass);

  if (value === 2) return "high";
  if (value === 1) return "moderate";
  if (value === 0) return "safe";

  return "unknown";
}

// ChatGPT-style progressive text reveal.
function Typewriter({ text, speed = 18 }) {
  const [visibleText, setVisibleText] = useState("");
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    setVisibleText("");
    setFinished(false);

    if (!text) {
      setFinished(true);
      return;
    }

    let index = 0;
    let timer;

    function typeNext() {
      index += 1;
      setVisibleText(text.slice(0, index));

      if (index < text.length) {
        timer = setTimeout(typeNext, speed);
      } else {
        setFinished(true);
      }
    }

    timer = setTimeout(typeNext, speed);

    return () => clearTimeout(timer);
  }, [text, speed]);

  return (
    <span className="suggestion-typewriter">
      <span aria-live="off">{visibleText}</span>
      {!finished && (
        <span
          className="suggestion-cursor"
          aria-hidden="true"
        />
      )}
    </span>
  );
}

function readNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    !Number.isFinite(Number(value))
  ) {
    return null;
  }

  return Number(value);
}

// Returns additional advice when sensor-specific rules are triggered.
function getEnvironmentalAdvice(readings = {}) {
  const advice = [];

  const dust = readNumber(readings.dust);
  const gas = readNumber(readings.gas);
  const humidity = readNumber(readings.humidity);
  const temperature = readNumber(readings.temperature);

  if (dust !== null && dust >= RULES.dust.threshold) {
    advice.push({
      id: "dust",
      title: RULES.dust.title,
      message: RULES.dust.advice,
    });
  }

  if (gas !== null && gas >= RULES.gas.threshold) {
    advice.push({
      id: "gas",
      title: RULES.gas.title,
      message: RULES.gas.advice,
    });
  }

  if (
    humidity !== null &&
    (humidity < RULES.humidity.low ||
      humidity > RULES.humidity.high)
  ) {
    advice.push({
      id: "humidity",
      title: RULES.humidity.title,
      message: RULES.humidity.advice,
    });
  }

  if (
    temperature !== null &&
    temperature >= RULES.temperature.high
  ) {
    advice.push({
      id: "temperature",
      title: RULES.temperature.title,
      message: RULES.temperature.advice,
    });
  }

  return advice;
}

export default function Suggestion({
  riskClass,
  readings = {},
}) {
  const risk = getRiskLevel(riskClass);
  const info = RISK_INFORMATION[risk];
  const environmentalAdvice = getEnvironmentalAdvice(readings);

  return (
    <section
      className="suggestion-card"
      style={{ "--suggestion-accent": info.color }}
    >
      <div className="suggestion-header">
        <span className="suggestion-header-icon">✦</span>

        <div>
          <h2>Environmental Monitoring</h2>
          <p className="suggestion-subtitle">
            AirGuard intelligent environmental assistant
          </p>
        </div>

        <span className="suggestion-offline-badge">
          OFFLINE
        </span>
      </div>

      <div className="suggestion-risk">
        <span className="suggestion-risk-label">
          {info.title}
        </span>

        <p className="suggestion-risk-message">
          <Typewriter
            key={`risk-${risk}`}
            text={info.message}
            speed={18}
          />
        </p>
      </div>

      <h3 className="suggestion-section-title">
        Personalized Environmental Suggestions
      </h3>

      <ul className="suggestion-list">
        {info.recommendations.map((item, index) => (
          <li
            className="suggestion-item"
            key={`${risk}-${item.title}`}
            style={{ animationDelay: `${index * 100}ms` }}
          >
            <span className="suggestion-item-icon">
              {String(index + 1).padStart(2, "0")}
            </span>

            <div>
              <strong className="suggestion-item-title">
                {item.title}
              </strong>

              <p className="suggestion-item-message">
                <Typewriter
                  key={`${risk}-${item.title}`}
                  text={item.message}
                  speed={18}
                />
              </p>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="suggestion-section-title">
        Live Sensor-Based Advice
      </h3>

      {environmentalAdvice.length > 0 ? (
        <ul className="suggestion-list">
          {environmentalAdvice.map((item, index) => (
            <li
              className="suggestion-item"
              key={item.id}
              style={{ animationDelay: `${index * 100}ms` }}
            >
              <span className="suggestion-item-icon">↳</span>

              <div>
                <strong className="suggestion-item-title">
                  {item.title}
                </strong>

                <p className="suggestion-item-message">
                  <Typewriter
                    key={`${item.id}-${item.message}`}
                    text={item.message}
                    speed={18}
                  />
                </p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="suggestion-empty">
          <span className="suggestion-empty-icon">✓</span>

          <div>
            <strong>
              No configured environmental thresholds triggered
            </strong>

            <p>
              The available readings did not trigger the current
              sensor-specific rules. This does not guarantee that
              the air is safe or free of asthma triggers.
            </p>
          </div>
        </div>
      )}

      <div className="suggestion-footer">
        <span className="suggestion-footer-icon">ⓘ</span>

        <p>
          AirGuard provides general environmental guidance, not a
          medical diagnosis. Recommendations are predefined rules,
          not live AI-generated medical advice. Thresholds are
          provisional and should be calibrated for your hardware.
          Follow your clinician-provided asthma action plan.
        </p>
      </div>
    </section>
  );
}
