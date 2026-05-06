// Shared market templates used by MarketNew and caretaker-scout.
// Each template pre-fills the market creation form fields.

export interface MarketTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  trend_model: "linear" | "moving_avg" | "exponential" | "log_linear" | "ewma" | "bollinger" | "seasonal";
  band_width: number;
  band_is_pct: boolean;
  unit: string;
  resolution_days_default: number;
  data_source: {
    provider: string;
    fetch_interval_minutes: number;
    params?: Record<string, string>;
  };
}

export const MARKET_TEMPLATES: MarketTemplate[] = [
  // --- Finance ---
  {
    id: "btc-price",
    name: "BTC price vs 30-day trend",
    category: "Finance",
    description: "Trade deviation of Bitcoin price from its 30-day moving average",
    trend_model: "moving_avg",
    band_width: 5,
    band_is_pct: true,
    unit: "USD",
    resolution_days_default: 7,
    data_source: { provider: "coingecko", fetch_interval_minutes: 60, params: { coin: "bitcoin", vs_currency: "usd" } },
  },
  {
    id: "eth-price",
    name: "ETH price vs 30-day trend",
    category: "Finance",
    description: "Trade deviation of Ethereum price from its 30-day moving average",
    trend_model: "moving_avg",
    band_width: 7,
    band_is_pct: true,
    unit: "USD",
    resolution_days_default: 7,
    data_source: { provider: "coingecko", fetch_interval_minutes: 60, params: { coin: "ethereum", vs_currency: "usd" } },
  },

  // --- Sports: UCL / Premier League ---
  {
    id: "player-goals-ucl",
    name: "Player goals vs UCL rolling average",
    category: "Sports",
    description: "Trade deviation from a player's goals-per-game trend over last 10 UCL games",
    trend_model: "moving_avg",
    band_width: 0.5,
    band_is_pct: false,
    unit: "goals",
    resolution_days_default: 1,
    data_source: { provider: "football_data", fetch_interval_minutes: 5, params: { stat: "goals", team: "away" } },
  },
  {
    id: "team-corners-game",
    name: "Match corners vs season average",
    category: "Sports",
    description: "Total corners in the match vs the home team's season average",
    trend_model: "moving_avg",
    band_width: 2,
    band_is_pct: false,
    unit: "corners",
    resolution_days_default: 1,
    data_source: { provider: "espn_soccer", fetch_interval_minutes: 5, params: { stat: "corners" } },
  },
  {
    id: "match-cards",
    name: "Match bookings vs referee average",
    category: "Sports",
    description: "Total yellow cards vs the assigned referee's UCL season average",
    trend_model: "moving_avg",
    band_width: 1.5,
    band_is_pct: false,
    unit: "cards",
    resolution_days_default: 1,
    data_source: { provider: "espn_soccer", fetch_interval_minutes: 5, params: { stat: "yellowCards" } },
  },
  {
    id: "team-goals-conceded-away",
    name: "Goals conceded away vs season trend",
    category: "Sports",
    description: "Away team goals conceded vs rolling 5-game average",
    trend_model: "moving_avg",
    band_width: 0.5,
    band_is_pct: false,
    unit: "goals",
    resolution_days_default: 1,
    data_source: { provider: "espn_soccer", fetch_interval_minutes: 5, params: { stat: "goals", team: "home" } },
  },
  {
    id: "player-shots-game",
    name: "Player shots on target vs rolling average",
    category: "Sports",
    description: "Individual player shots on target per game vs rolling average",
    trend_model: "moving_avg",
    band_width: 1.5,
    band_is_pct: false,
    unit: "shots",
    resolution_days_default: 1,
    data_source: { provider: "espn_soccer", fetch_interval_minutes: 5, params: { stat: "shotsOnTarget" } },
  },

  // --- Economics ---
  {
    id: "us-cpi-monthly",
    name: "US CPI vs economist forecast",
    category: "Economics",
    description: "Monthly CPI reading vs the Bloomberg consensus forecast",
    trend_model: "linear",
    band_width: 0.2,
    band_is_pct: false,
    unit: "%",
    resolution_days_default: 30,
    data_source: { provider: "fred", fetch_interval_minutes: 1440, params: { series_id: "CPIAUCSL" } },
  },

  // --- Weather ---
  {
    id: "london-temp",
    name: "London daily temperature vs seasonal norm",
    category: "Weather",
    description: "Daily high temperature in London vs 10-year seasonal average",
    trend_model: "seasonal",
    band_width: 3,
    band_is_pct: false,
    unit: "°C",
    resolution_days_default: 3,
    data_source: { provider: "open_meteo", fetch_interval_minutes: 60, params: { latitude: "51.5", longitude: "-0.1", variable: "temperature_2m_max" } },
  },
];
