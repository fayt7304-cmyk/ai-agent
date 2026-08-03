const weatherCodeMap: Record<number, string> = {
  0: "☀️ Clear sky",
  1: "🌤️ Mostly clear",
  2: "⛅ Partly cloudy",
  3: "☁️ Overcast",
  45: "🌫️ Fog",
  48: "🌫️ Depositing rime fog",
  51: "🌦️ Light drizzle",
  53: "🌦️ Drizzle",
  55: "🌦️ Dense drizzle",
  61: "🌧️ Light rain",
  63: "🌧️ Rain",
  65: "🌧️ Heavy rain",
  71: "🌨️ Light snow",
  73: "🌨️ Snow",
  75: "🌨️ Heavy snow",
  80: "🌦️ Rain showers",
  81: "🌦️ Rain showers",
  82: "🌦️ Violent rain showers",
  95: "⛈️ Thunderstorm",
  96: "⛈️ Thunderstorm with hail",
};

function weatherIcon(code: number): string {
  const entry = weatherCodeMap[code] || "❓";
  return entry.split(" ")[0];
}
function weatherDesc(code: number): string {
  const entry = weatherCodeMap[code];
  return entry ? entry.split(" ").slice(1).join(" ") : "Weather code " + code;
}

export function initWeather() {
  // Weather loads lazily the first time the Weather sub-tab is opened
  // (see tools-view.ts), so there's nothing to do on init.
}

export function loadWeather() {
  const content = document.getElementById("weather-content") as HTMLDivElement;
  content.innerHTML = '<div class="status working" id="weather-status">Getting your location…</div>';

  function showRetry(message: string) {
    content.innerHTML =
      '<div class="status">' + message + '</div>' + '<button class="tab" id="weather-retry" style="margin-top:8px;">Try again</button>';
    const retryBtn = document.getElementById("weather-retry");
    retryBtn?.addEventListener("click", loadWeather);
  }

  function renderWeather(placeName: string, data: any) {
    const c = data.current;
    const hourly = data.hourly;
    const daily = data.daily;

    const nowIso = new Date(Date.now() + (data.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13);
    let startIdx = hourly.time.findIndex((t: string) => t.startsWith(nowIso));
    if (startIdx === -1) startIdx = 0;
    const next24 = [];
    for (let i = startIdx; i < Math.min(startIdx + 24, hourly.time.length); i++) {
      next24.push({
        time: hourly.time[i],
        temp: hourly.temperature_2m[i],
        precipProb: hourly.precipitation_probability[i],
        code: hourly.weather_code[i],
      });
    }

    const hourlyHtml = next24
      .map((h) => {
        const hour = new Date(h.time).getHours();
        const label = hour === 0 ? "12am" : hour < 12 ? hour + "am" : hour === 12 ? "12pm" : hour - 12 + "pm";
        return `
        <div class="hour-card">
          <div class="h-time">${label}</div>
          <div class="h-icon">${weatherIcon(h.code)}</div>
          <div class="h-temp">${Math.round(h.temp)}°</div>
          <div>${h.precipProb}%</div>
        </div>`;
      })
      .join("");

    const dailyHtml = daily.time
      .map((dateStr: string, i: number) => {
        const date = new Date(dateStr + "T00:00:00");
        const dayLabel = i === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" });
        return `
        <div class="day-row">
          <div>${dayLabel}</div>
          <div class="d-icon">${weatherIcon(daily.weather_code[i])}</div>
          <div class="d-precip">${weatherDesc(daily.weather_code[i])} · ${daily.precipitation_sum[i]} mm precip</div>
          <div class="d-temps"><span class="d-max">${Math.round(daily.temperature_2m_max[i])}°</span> / <span class="d-min">${Math.round(daily.temperature_2m_min[i])}°</span></div>
        </div>`;
      })
      .join("");

    content.innerHTML = `
      <div class="weather-place">${placeName}
        <a href="https://www.google.com/search?q=${encodeURIComponent("weather in " + placeName)}"
           target="_blank" rel="noopener"
           style="margin-left:10px; font-size:12px; color:var(--accent); text-decoration:none;">
          Open on Google Weather ↗
        </a>
      </div>
      <div class="weather-main">
        <div class="weather-temp">${Math.round(c.temperature_2m)}°C</div>
        <div class="weather-details">
          ${weatherIcon(c.weather_code)} ${weatherDesc(c.weather_code)}<br>
          Feels like ${Math.round(c.apparent_temperature)}°C · Precipitation ${c.precipitation} mm<br>
          Humidity ${c.relative_humidity_2m}% · Wind ${Math.round(c.wind_speed_10m)} km/h
        </div>
      </div>
      <div class="uc-section-title">Next 24 hours</div>
      <div class="hourly-scroll">${hourlyHtml}</div>
      <div class="uc-section-title">7-day forecast</div>
      <div class="daily-list">${dailyHtml}</div>
    `;
  }

  function showWeather(lat: number, lon: number, placeName: string) {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m,apparent_temperature,precipitation` +
      `&hourly=temperature_2m,precipitation_probability,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&timezone=auto&forecast_days=7`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error("Weather service returned " + r.status);
        return r.json();
      })
      .then((data) => renderWeather(placeName, data))
      .catch((err) => showRetry("Could not load weather data (" + err.message + ")."));
  }

  function reverseGeocodeAndShow(lat: number, lon: number) {
    fetch(`https://geocoding-api.open-meteo.com/v1/reverse?latitude=${lat}&longitude=${lon}`)
      .then((r) => r.json())
      .then((data) => {
        const place = data.results && data.results[0] ? [data.results[0].name, data.results[0].country].filter(Boolean).join(", ") : null;
        if (!place) throw new Error("No result");
        showWeather(lat, lon, place);
      })
      .catch(() => {
        // Fallback to a different provider (some ad blockers flag
        // geocoding-api.open-meteo.com; this one uses a different domain).
        fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`)
          .then((r) => r.json())
          .then((data) => {
            const place = [data.city || data.locality, data.countryName].filter(Boolean).join(", ");
            showWeather(lat, lon, place || `${lat.toFixed(2)}, ${lon.toFixed(2)}`);
          })
          .catch(() => showWeather(lat, lon, `${lat.toFixed(2)}, ${lon.toFixed(2)}`));
      });
  }

  function tryIpapi(): Promise<{ lat: number; lon: number }> {
    return fetch("https://ipapi.co/json/")
      .then((r) => {
        if (!r.ok) throw new Error("ipapi.co returned " + r.status);
        return r.json();
      })
      .then((data) => {
        if (!data.latitude || !data.longitude) throw new Error("No coordinates returned");
        return { lat: data.latitude, lon: data.longitude };
      });
  }

  function tryIpwho(): Promise<{ lat: number; lon: number }> {
    return fetch("https://ipwho.is/")
      .then((r) => r.json())
      .then((data) => {
        if (!data.success || !data.latitude || !data.longitude) throw new Error("No coordinates returned");
        return { lat: data.latitude, lon: data.longitude };
      });
  }

  function fallbackToIp() {
    const status = document.getElementById("weather-status");
    if (status) status.textContent = "Location permission unavailable, trying approximate location…";

    tryIpapi()
      .then(({ lat, lon }) => reverseGeocodeAndShow(lat, lon))
      .catch(() => {
        tryIpwho()
          .then(({ lat, lon }) => reverseGeocodeAndShow(lat, lon))
          .catch((err) => showRetry("Could not determine your location automatically (" + err.message + "). This can happen if a browser extension blocks location-lookup services."));
      });
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => reverseGeocodeAndShow(pos.coords.latitude, pos.coords.longitude),
      (err) => {
        console.warn("Geolocation denied or failed:", err.message);
        fallbackToIp();
      },
      { timeout: 8000 }
    );
  } else {
    fallbackToIp();
  }
}
