import { PrismaClient } from "../server/generated/prisma/index.js";

export const prisma = new PrismaClient();

export async function saveSnapshot({
  openOrders,
  balances,
  offsetIds,
}: {
  openOrders: Record<string, any>;
  balances: Record<string, number>;
  offsetIds: { prices: string; trades: string };
}): Promise<any> {
  return await prisma.engineSnapshot.create({
    data: {
      open_orders: openOrders,
      balances: balances,
      offsetId: offsetIds,
    },
  });
}

export async function getLatestSnapshot(): Promise<any> {
  return await prisma.engineSnapshot.findFirst({
    orderBy: { createdAt: "desc" },
  });
}

export async function saveClosedTrade(trade: {
  userId: string;
  assetSymbol: string;
  openPrice: number;
  closePrice: number;
  leverage: number;
  margin: number;
  quantity: number;
  pnl: number;
}): Promise<any> {
  const asset = await prisma.asset.findUnique({
    where: { symbol: trade.assetSymbol },
  });

  if (!asset) {
    throw new Error(`Asset ${trade.assetSymbol} not found`);
  }

  return await prisma.existingTrade.create({
    data: {
      userId: trade.userId,
      assetId: asset.id,
      openPrice: trade.openPrice,
      closePrice: trade.closePrice,
      leverage: trade.leverage,
      margin: trade.margin,
      quantity: trade.quantity,
      pnl: trade.pnl,
      closedAt: new Date(),
    },
  });
}

export async function createAssets(): Promise<void> {
  const assets = [
    { symbol: "SOL", name: "Solana", decimals: 4 },
    { symbol: "ETH", name: "Ethereum", decimals: 6 },
    { symbol: "BTC", name: "Bitcoin", decimals: 6 },
  ];

  for (const asset of assets) {
    await prisma.asset.upsert({
      where: { symbol: asset.symbol },
      update: {},
      create: asset,
    });
  }
  
  console.log("Assets created/verified");
}
