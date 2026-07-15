# Project Rules

- **MoebyBridge (`/bridge/*`, `server/mt5bridge.ts`) is the only MT5 integration; never generate an alternative MT5 transport.**
- Real market prices (from Bybit or similar) should always be used for marking paper/demo trades and executing stops. Do not use random walks for Gold price.
- Spread risk checks must fail-closed if spread/price data is unavailable, rather than failing open with random fallback.
