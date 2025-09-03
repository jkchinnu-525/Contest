import { createClient } from "redis";
import { w3cwebsocket as websocket } from "websocket";

const publisher = createClient({
  url: "redis://localhost:6379",
});
const URL = "wss://ws.backpack.exchange/";
const payload = {
  method: "SUBSCRIBE",
  params: [
    "bookTicker.SOL_USDC_PERP",
    "bookTicker.BTC_USDC_PERP",
    "bookTicker.ETH_USDC_PERP",
  ],
};

async function connectRedis() {
  await publisher.connect();
  console.log("Redis Connected");

  const ws = new websocket(URL);
  const latestPrices: any = {};
  let hasChange = false;
  ws.onopen = () => {
    console.log("Connected To Websocket");
    ws.send(JSON.stringify(payload));
  };

  ws.onmessage = (event) => {
    try {
      const response = JSON.parse(event.data as string);
      const marketData = response?.data;
      if (marketData) {
        const symbol = marketData.s;
        const price = marketData.a;
        if (latestPrices[symbol] !== price) {
          latestPrices[symbol] = price;
          hasChange = true;
          console.log(latestPrices);
        }
      }
    } catch (e) {
      console.error("Failed to parse message", e);
    }
  };

  ws.onclose = () => {
    console.log("Disconnected");
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };
  setInterval(() => {
    if (hasChange) {
      publisher.publish("trades", JSON.stringify(latestPrices));
      hasChange = false;
    }
  }, 100);
}

connectRedis();
