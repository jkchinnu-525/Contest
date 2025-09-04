import { createClient } from "redis";

const client = createClient({
  url: "redis://localhost:6379",
});

const trades = new Map<string, any>();

function arrayToObject(
  tradesArray: Array<{ asset: string; price: number; decimal: number }>,
) {
  const tradesObject: Record<string, { price: number; decimal: number }> = {};
  tradesArray.forEach(({ asset, price, decimal }) => {
    tradesObject[asset] = { price, decimal };
  });
  return tradesObject;
}

async function connect() {
  try {
    await client.connect();
    console.log("Subscriber Connected");
    await client.xGroupCreate("trade-stream", "engine-group", "$", {
      MKSTREAM: true,
    });
    client.subscribe("trades", (message) => {
      const data = JSON.parse(message);
      if (Array.isArray(data)) {
        const tradesData = arrayToObject(data);
        console.log("Trades:", tradesData);
      }
    });
  } catch (error) {
    console.log("Erorr while connecting to redis..", error);
  }
}

async function consumer() {
  while (true) {
    const res = await client.XREADGROUP("engine-group", "engine-1", {
      key: "trade-stream",
      id: ">",
    });
    if (res) {
      for (const msg of res.messages) {
        await client.xAck("trade-stream", "engine-group", msg.id);
      }
    }
  }
}
await connect();
consumer();
