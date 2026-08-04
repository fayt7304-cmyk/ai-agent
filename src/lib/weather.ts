import { t, getStoredLang } from "./i18n";

// Icons are language-agnostic; only the condition text needs translating.
const weatherIcons: Record<number, string> = {
  0: "☀️", 1: "🌤️", 2: "⛅", 3: "☁️", 45: "🌫️", 48: "🌫️",
  51: "🌦️", 53: "🌦️", 55: "🌦️", 61: "🌧️", 63: "🌧️", 65: "🌧️",
  71: "🌨️", 73: "🌨️", 75: "🌨️", 80: "🌦️", 81: "🌦️", 82: "🌦️",
  95: "⛈️", 96: "⛈️",
};

// Open-Meteo's WMO weather codes, translated per language. Kept here (rather than
// as flat i18n.ts keys) since these are keyed by numeric code, not a dotted string.
const weatherConditions: Record<string, Record<number, string>> = {
  en: {
    0: "Clear sky", 1: "Mostly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Dense drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    80: "Rain showers", 81: "Rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 96: "Thunderstorm with hail",
  },
  fr: {
    0: "Ciel dégagé", 1: "Plutôt dégagé", 2: "Partiellement nuageux", 3: "Couvert",
    45: "Brouillard", 48: "Brouillard givrant",
    51: "Bruine légère", 53: "Bruine", 55: "Bruine dense",
    61: "Pluie légère", 63: "Pluie", 65: "Forte pluie",
    71: "Neige légère", 73: "Neige", 75: "Forte neige",
    80: "Averses de pluie", 81: "Averses de pluie", 82: "Fortes averses de pluie",
    95: "Orage", 96: "Orage avec grêle",
  },
  es: {
    0: "Cielo despejado", 1: "Mayormente despejado", 2: "Parcialmente nublado", 3: "Cubierto",
    45: "Niebla", 48: "Niebla escarchada",
    51: "Llovizna ligera", 53: "Llovizna", 55: "Llovizna densa",
    61: "Lluvia ligera", 63: "Lluvia", 65: "Lluvia fuerte",
    71: "Nieve ligera", 73: "Nieve", 75: "Nieve fuerte",
    80: "Chubascos", 81: "Chubascos", 82: "Chubascos violentos",
    95: "Tormenta", 96: "Tormenta con granizo",
  },
  zh: {
    0: "晴朗", 1: "大致晴朗", 2: "局部多云", 3: "阴天",
    45: "雾", 48: "雾凇",
    51: "小毛毛雨", 53: "毛毛雨", 55: "浓密毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    71: "小雪", 73: "中雪", 75: "大雪",
    80: "阵雨", 81: "阵雨", 82: "强阵雨",
    95: "雷暴", 96: "雷暴伴冰雹",
  },
  ar: {
    0: "سماء صافية", 1: "صافٍ غالبًا", 2: "غائم جزئيًا", 3: "غائم تمامًا",
    45: "ضباب", 48: "ضباب متجمد",
    51: "رذاذ خفيف", 53: "رذاذ", 55: "رذاذ كثيف",
    61: "مطر خفيف", 63: "مطر", 65: "مطر غزير",
    71: "ثلج خفيف", 73: "ثلج", 75: "ثلج غزير",
    80: "زخات مطر", 81: "زخات مطر", 82: "زخات مطر عنيفة",
    95: "عاصفة رعدية", 96: "عاصفة رعدية مصحوبة ببرد",
  },
};

function weatherIcon(code: number): string {
  return weatherIcons[code] || "❓";
}
function weatherDesc(code: number): string {
  const lang = getStoredLang();
  return weatherConditions[lang]?.[code] || weatherConditions.en[code] || `Weather code ${code}`;
}

export function initWeather() {
  // Weather loads lazily the first time the Weather sub-tab is opened
  // (see tools-view.ts), so there's nothing to do on init.
}

export function loadWeather() {
  const content = document.getElementById("weather-content") as HTMLDivElement;
  content.innerHTML = `<div class="status working" id="weather-status">${t("weather.gettingLocation")}</div>`;

  function showRetry(message: string) {
    content.innerHTML =
      '<div class="status">' + message + '</div>' +
      `<button class="tab" id="weather-retry" style="margin-top:8px;">${t("weather.tryAgain")}</button>`;
    const retryBtn = document.getElementById("weather-retry");
    retryBtn?.addEventListener("click", loadWeather);
  }

  function renderWeather(placeName: string, data: any) {
    const c = data.current;
    const hourly = data.hourly;
    const daily = data.daily;
    const locale = { en: "en-US", fr: "fr-FR", es: "es-ES", zh: "zh-CN", ar: "ar-SA" }[getStoredLang()] || "en-US";

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
        const dayLabel = i === 0 ? t("weather.today") : date.toLocaleDateString(locale, { weekday: "short" });
        return `
        <div class="day-row">
          <div>${dayLabel}</div>
          <div class="d-icon">${weatherIcon(daily.weather_code[i])}</div>
          <div class="d-precip">${weatherDesc(daily.weather_code[i])} · ${daily.precipitation_sum[i]} mm</div>
          <div class="d-temps"><span class="d-max">${Math.round(daily.temperature_2m_max[i])}°</span> / <span class="d-min">${Math.round(daily.temperature_2m_min[i])}°</span></div>
        </div>`;
      })
      .join("");

    content.innerHTML = `
      <div class="weather-place">${placeName}
        <a href="https://www.google.com/search?q=${encodeURIComponent("weather in " + placeName)}"
           target="_blank" rel="noopener"
           style="margin-left:10px; font-size:12px; color:var(--accent); text-decoration:none;">
          ${t("weather.openGoogle")} ↗
        </a>
      </div>
      <div class="weather-main">
        <div class="weather-temp">${Math.round(c.temperature_2m)}°C</div>
        <div class="weather-details">
          ${weatherIcon(c.weather_code)} ${weatherDesc(c.weather_code)}<br>
          ${t("weather.feelsLike")} ${Math.round(c.apparent_temperature)}°C · ${t("weather.precipitation")} ${c.precipitation} mm<br>
          ${t("weather.humidity")} ${c.relative_humidity_2m}% · ${t("weather.wind")} ${Math.round(c.wind_speed_10m)} km/h
        </div>
      </div>
      <div class="uc-section-title">${t("weather.next24h")}</div>
      <div class="hourly-scroll">${hourlyHtml}</div>
      <div class="uc-section-title">${t("weather.forecast7d")}</div>
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
      .catch((err) => showRetry(`${t("weather.loadError")} (${err.message}).`));
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
    if (status) status.textContent = t("weather.locationFallback");

    tryIpapi()
      .then(({ lat, lon }) => reverseGeocodeAndShow(lat, lon))
      .catch(() => {
        tryIpwho()
          .then(({ lat, lon }) => reverseGeocodeAndShow(lat, lon))
          .catch(() => showRetry(t("weather.locationError")));
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
