// Templates and provider definitions for one-click market creation.
import type { TrendModel } from "./trend";

export type ProviderId = "coingecko" | "yahoo" | "open-meteo" | "github" | "nasa-co2" | "polymarket";

export type Template = {
  id: string;
  category: string;
  label: string;
  unit: string;
  trend_model: TrendModel;
  band_width: number;
  band_is_pct: boolean;
  provider: ProviderId;
  provider_params: Record<string, unknown>;
  fetch_interval_minutes: number;
  description: string;
};

export const TEMPLATES: Template[] = [
  // Crypto
  { id: "btc-usd", category: "Crypto", label: "Bitcoin (BTC) price",
    unit: "USD", trend_model: "ewma", band_width: 8, band_is_pct: true,
    provider: "coingecko", provider_params: { id: "bitcoin", vs: "usd" },
    fetch_interval_minutes: 15,
    description: "Trade distortion vs the moving average of BTC price." },
  { id: "eth-usd", category: "Crypto", label: "Ethereum (ETH) price",
    unit: "USD", trend_model: "ewma", band_width: 8, band_is_pct: true,
    provider: "coingecko", provider_params: { id: "ethereum", vs: "usd" },
    fetch_interval_minutes: 15, description: "Distortion vs trend on ETH." },
  { id: "sol-usd", category: "Crypto", label: "Solana (SOL) price",
    unit: "USD", trend_model: "bollinger", band_width: 0, band_is_pct: false,
    provider: "coingecko", provider_params: { id: "solana", vs: "usd" },
    fetch_interval_minutes: 15, description: "Bollinger-band elastic on SOL." },

  // Stocks
  { id: "aapl", category: "Stocks", label: "Apple (AAPL) price",
    unit: "USD", trend_model: "linear", band_width: 5, band_is_pct: true,
    provider: "yahoo", provider_params: { symbol: "AAPL" },
    fetch_interval_minutes: 60, description: "Trend distortion on AAPL." },
  { id: "nvda", category: "Stocks", label: "Nvidia (NVDA) price",
    unit: "USD", trend_model: "log_linear", band_width: 10, band_is_pct: true,
    provider: "yahoo", provider_params: { symbol: "NVDA" },
    fetch_interval_minutes: 60, description: "Compounding-growth band on NVDA." },
  { id: "tsla", category: "Stocks", label: "Tesla (TSLA) price",
    unit: "USD", trend_model: "ewma", band_width: 12, band_is_pct: true,
    provider: "yahoo", provider_params: { symbol: "TSLA" },
    fetch_interval_minutes: 60, description: "EWMA band on TSLA." },

  // Weather
  { id: "weather-nyc", category: "Weather", label: "NYC temperature",
    unit: "°C", trend_model: "seasonal", band_width: 4, band_is_pct: false,
    provider: "open-meteo", provider_params: { lat: 40.71, lon: -74.01, variable: "temperature_2m" },
    fetch_interval_minutes: 60, description: "Seasonal band on NYC temperature." },
  { id: "weather-london", category: "Weather", label: "London temperature",
    unit: "°C", trend_model: "seasonal", band_width: 4, band_is_pct: false,
    provider: "open-meteo", provider_params: { lat: 51.51, lon: -0.13, variable: "temperature_2m" },
    fetch_interval_minutes: 60, description: "Seasonal band on London temperature." },

  // Climate
  { id: "co2-mlo", category: "Climate", label: "Atmospheric CO₂ (Mauna Loa)",
    unit: "ppm", trend_model: "log_linear", band_width: 1, band_is_pct: true,
    provider: "nasa-co2", provider_params: {},
    fetch_interval_minutes: 60 * 24, description: "Long-term CO₂ trend distortion." },

  // Code
  { id: "gh-react-stars", category: "Code", label: "React stars (facebook/react)",
    unit: "stars", trend_model: "log_linear", band_width: 2, band_is_pct: true,
    provider: "github", provider_params: { repo: "facebook/react", metric: "stargazers_count" },
    fetch_interval_minutes: 60 * 6, description: "Star-count distortion on React." },
];

export function templateById(id: string) {
  return TEMPLATES.find((t) => t.id === id);
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  "coingecko": "CoinGecko",
  "yahoo": "Yahoo Finance",
  "open-meteo": "Open-Meteo",
  "github": "GitHub",
  "nasa-co2": "NOAA Mauna Loa",
  "polymarket": "Polymarket",
};
