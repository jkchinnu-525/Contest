import { createClient } from "redis";
import {
  createAssets,
  getLatestSnapshot,
  prisma,
  saveClosedTrade,
  saveSnapshot
} from "./db.js";
import { calculateTrade } from "./services/index.js";
import { Price, TradeRequest } from "./types/index.js";

interface StreamMessage {
  id: string;
  message: Record<string, string>;
}

interface StreamResponse {
  name: string;
  messages: StreamMessage[];
}

let snapshotInterval: NodeJS.Timeout;

const client = createClient({
  url: "redis://localhost:6379",
});

const userBalance = new Map<string, number>();
const openOrders = new Map<string, any>();
const currentPrice = new Map<string, Price>();

const lastProcessedIds = {
  prices: "0-0",
  trades: "0-0",
};

export async function initializeEngine() {
  await client.connect();
  console.log("Client Connected");

  await createAssets();
  await restoreFromSnapshot();
  await createConsumerGroups();

  startPriceConsumer();
  startTradeConsumer();
  startCloseConsumer();
  startSnapshotting();
  console.log("Trading engine initialized successfully");
}

async function createConsumerGroups() {
  try {
    await client.xGroupCreate(
      "trade-requests-stream",
      "trades-engine-group",
      "$",
      { MKSTREAM: true },
    );
    await client.xGroupCreate(
      "price-updates-stream",
      "price-engine-group",
      "$",
      { MKSTREAM: true },
    );
    await client.xGroupCreate(
      "trade-close-stream",
      "close-engine-group",
      "$",
      { MKSTREAM: true },
    );
    console.log("Redis Groups have been created");
  } catch (error) {
    console.log("Error while creating groups", error);
  }
}

async function startPriceConsumer() {
  const consumerName = `price-consumer-${Date.now()}`;
  console.log("Started price consumer:", consumerName);
  while (true) {
    try {
      const response = await client.xReadGroup(
        "price-engine-group",
        consumerName,
        { key: "price-updates-stream", id: ">" },
      );
      if (!response || !Array.isArray(response)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const streams = response as StreamResponse[];
      for (const stream of streams) {
        const streamData = stream as StreamResponse;
        for (const message of streamData.messages) {
          await processPriceUpdate(message);
          await client.xAck(
            "price-updates-stream",
            "price-engine-group",
            message.id,
          );
        }
      }
    } catch (error) {
      console.log("Error in price consumer:", error);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function processPriceUpdate(message: any) {
  const { asset, price, timestamp } = message.message;
  try {
    currentPrice.set(asset, {
      price: Number(price),
      timestamp: Number(timestamp),
    });
    lastProcessedIds.prices = message.id;
    console.log(`Updated prices for ${asset}: $${price}`);
  } catch (error) {
    console.log("Error while updating the prices:", error);
  }
}

export function getCurrentPrice(asset: string): Price | undefined {
  return currentPrice.get(asset);
}

async function startTradeConsumer() {
  const consumerName = `trade-consumer-${Date.now()}`;
  console.log("Started Trader Consumer:", consumerName);
  while (true) {
    try {
      const response = await client.xReadGroup(
        "trades-engine-group",
        consumerName,
        { key: "trade-requests-stream", id: ">" },
      );
      if (!response || !Array.isArray(response)) {
        await new Promise(resolve => setTimeout(resolve, 1000)); 
        continue;
      }
      const streams = response as StreamResponse[];
      for (const stream of streams) {
        const streamData = stream as StreamResponse;
        for (const message of streamData.messages) {
          await processTradeRequest(message);
          await client.xAck(
            "trade-requests-stream",
            "trades-engine-group",
            message.id,
          );
        }
      }
    } catch (error) {
      console.log("Error in trade consumer:", error);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function startCloseConsumer() {
  const consumerName = `close-consumer-${Date.now()}`;
  console.log("Started Close Consumer:", consumerName);
  while (true) {
    try {
      const response = await client.xReadGroup(
        "close-engine-group",
        consumerName,
        { key: "trade-close-stream", id: ">" },
      );
      if (!response || !Array.isArray(response)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        continue;
      }
      const streams = response as StreamResponse[];
      for (const stream of streams) {
        const streamData = stream as StreamResponse;
        for (const message of streamData.messages) {
          await processCloseRequest(message);
          await client.xAck(
            "trade-close-stream",
            "close-engine-group",
            message.id,
          );
        }
      }
    } catch (error) {
      console.log("Error in close consumer:", error);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

async function processCloseRequest(message: any) {
  const { orderId } = message.message;
  try {
    const result = await closeOrder(orderId);
    console.log(`Order ${orderId} closed successfully with PnL: ${result.pnl}`);
  } catch (error) {
    console.error(`Failed to close order ${orderId}:`, error);
  }
}

async function processTradeRequest(message: any) {
  const tradeData: TradeRequest = message.message;
  const { asset, type, leverage, margin, slippage, userId } = tradeData;
  const priceData = currentPrice.get(asset);
  if (!priceData) {
    console.error(`No price data available for ${asset}, skipping trade`);
    return;
  }
  try {
    const tradeData = calculateTrade({
      asset,
      type,
      leverage: Number(leverage),
      margin: Number(margin),
      slippage: Number(slippage),
      userId,
      currentPrice: priceData.price,
    });
    await updateUserState(userId, tradeData);
    lastProcessedIds.trades = message.id;
    console.log(
      `Trade request has been processed for ${userId} at ${priceData.price}`,
    );
  } catch (error) {
    console.log("Error while proceesing trade request:", error);
  }
}

async function updateUserState(userId: string, tradeResult: any) {
  const currentBalance = userBalance.get(userId) || 5000;
  const newBalance = currentBalance - tradeResult.margin;
  userBalance.set(userId, newBalance);
  openOrders.set(tradeResult.orderId, {
    ...tradeResult,
    userId,
  });
  await client.hSet(`user:${userId}:orders`, tradeResult.orderId, JSON.stringify({
    ...tradeResult,
    userId,
  }));
  await client.hSet(`user:${userId}`, 'balance', newBalance.toString());
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { balance: newBalance }
    });
  console.log(`Updated Balance for user ${userId}: ${newBalance}`);
} catch (error) {
  console.error("Error updating database balance:", error);
  }
}

async function restoreFromSnapshot() {
  try {
    const snapshot = await getLatestSnapshot();

    if (snapshot) {
      console.log("Restoring engine state from snapshot...");

      if (snapshot.open_orders) {
        for (const [orderId, orderData] of Object.entries(
          snapshot.open_orders as any,
        )) {
          openOrders.set(orderId, orderData);
        }
      }

      if (snapshot.balances) {
        for (const [userId, balance] of Object.entries(snapshot.balances as any)) {
          userBalance.set(userId, balance as number);
        }
      }

      const offsetIds = snapshot.offsetIds as any;
      if (offsetIds) {
        lastProcessedIds.prices = offsetIds.prices || "0-0";
        lastProcessedIds.trades = offsetIds.trades || "0-0";
      }

      console.log(
        `Restored ${openOrders.size} open orders and ${userBalance.size} user balances`,
      );
    } else {
      console.log("No snapshot found, starting with empty state");
      const users = await prisma.user.findMany({ select: {id: true, balance: true}})
      for (const user of users) {
        userBalance.set(user.id, user.balance);
        await client.hSet(`user:${user.id}`, 'balance', user.balance.toString());
      }
    }
  } catch (error) {
    console.error("Error restoring from snapshot:", error);
  }
}

function startSnapshotting() {
  snapshotInterval = setInterval(async () => {
    try {
      await saveSnapshot({
        openOrders: Object.fromEntries(openOrders),
        balances: Object.fromEntries(userBalance),
        offsetIds: lastProcessedIds,
      });

      console.log(
        `Snapshot saved - Orders: ${openOrders.size}, Users: ${userBalance.size}`,
      );
    } catch (error) {
      console.error("Error saving snapshot:", error);
    }
  }, 10000);
}

export async function closeOrder(orderId: string) {
  const order = openOrders.get(orderId);
  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const currentPriceData = currentPrice.get(order.asset);
  if (!currentPriceData) {
    throw new Error(`No current price data for ${order.asset}`);
  }

  const closePrice = currentPriceData.price;
  const pnl = calculatePnL(order, closePrice);

  await saveClosedTrade({
    userId: order.userId,
    assetSymbol: order.asset,
    openPrice: order.executionPrice,
    closePrice,
    leverage: order.leverage,
    margin: order.margin,
    quantity: order.quantity,
    pnl,
  });

  const currentBalance = userBalance.get(order.userId) || 0;
  const newBalance = currentBalance + pnl + order.margin;
  userBalance.set(order.userId, newBalance);
  await prisma.user.update({
    where: { id: order.userId },
    data: { balance: newBalance }
  });
  await client.hSet(`user:${order.userId}`, 'balance', newBalance.toString());
  openOrders.delete(orderId);
  await client.hDel(`user:${order.userId}:orders`, orderId);
  console.log(`Closed order ${orderId} with PnL: ${pnl}`);
  return { orderId, pnl, closePrice };
}

function calculatePnL(order: any, closePrice: number): number {
  const priceChange = closePrice - order.executionPrice;
  const direction = order.type === "buy" ? 1 : -1;
  return priceChange * direction * order.quantity;
}

// export function shutdownEngine() {
//   if (snapshotInterval) {
//     clearInterval(snapshotInterval);
//   }

//   saveSnapshot({
//     openOrders: Object.fromEntries(openOrders),
//     balances: Object.fromEntries(userBalance),
//     offsetIds: lastProcessedIds,
//   }).then(() => {
//     console.log("Final snapshot saved before shutdown");
//     process.exit(0);
//   });
// }
