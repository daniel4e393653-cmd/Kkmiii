export interface LiquidityPosition {
  id: string;
  poolId: string;
  coinTypeA: string;
  coinTypeB: string;
  amountA: string;
  amountB: string;
  tickLower: number;
  tickUpper: number;
  currentTick: number;
  currentPrice: string;
  sqrtPrice: string;
  liquidity: string;
  feeGrowthGlobalA: string;
  feeGrowthGlobalB: string;
  tokenDecimalsA: number;
  tokenDecimalsB: number;
  symbolA: string;
  symbolB: string;
}

export interface PoolInfo {
  id: string;
  coinTypeA: string;
  coinTypeB: string;
  tickSpacing: number;
  feeRate: number;
  currentTick: number;
  currentPrice: string;
  sqrtPrice: string;
  liquidity: string;
  tokenDecimalsA: number;
  tokenDecimalsB: number;
  symbolA: string;
  symbolB: string;
}

export interface RebalanceConfig {
  slippageTolerance: number; // in percentage (e.g., 0.5 = 0.5%)
  rangeWidthPercent: number; // price range width as percentage of current price
  minRebalanceInterval: number; // minimum seconds between rebalances
  gasBudget: number;
  autoRebalance: boolean;
}

export interface BotState {
  isRunning: boolean;
  lastRebalanceTime: number | null;
  rebalanceCount: number;
  totalGasSpent: string;
  errors: string[];
}

export interface RebalanceResult {
  success: boolean;
  txHash?: string;
  gasCost?: string;
  newPositionId?: string;
  newTickLower?: number;
  newTickUpper?: number;
  error?: string;
}

export interface TokenBalance {
  coinType: string;
  symbol: string;
  decimals: number;
  balance: string;
}
