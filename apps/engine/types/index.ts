export interface Price {
  price: number;
  timestamp: number;
}

export interface TradeRequest {
  asset: string;
  type: string;
  margin: string;
  leverage: string;
  slippage: string;
  timestamp: string;
  userId: string;
}
