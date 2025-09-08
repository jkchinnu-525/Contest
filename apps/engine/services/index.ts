import { v4 as uuidv4 } from "uuid";
export function calculateTrade(params: {
  asset: string;
  type: string;
  leverage: number;
  margin: number;
  slippage: number;
  currentPrice: number;
  userId: string;
}) {
  const { asset, type, leverage, margin, slippage, currentPrice } = params;
  const slippageMultiplier =
    type === "buy" ? 1 + slippage / 100 : 1 - slippage / 100;

  const executionPrice = currentPrice * slippageMultiplier;
  const positionValue = margin * leverage;
  const quantity = positionValue / executionPrice;

  return {
    orderId: uuidv4(),
    asset,
    type,
    quantity,
    executionPrice,
    positionValue,
    margin,
    leverage,
    timestamp: Date.now(),
  };
}
