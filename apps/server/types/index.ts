export interface Order {
  asset: string;
  type: "buy" | "sell";
  margin: number;
  leverage: number;
  slippage: number;
}
