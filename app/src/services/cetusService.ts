import { initCetusSDK, CetusClmmSDK } from '@cetusprotocol/cetus-sui-clmm-sdk';
import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';
import BN from 'bignumber.js';
import type { LiquidityPosition, PoolInfo, RebalanceConfig, RebalanceResult, TokenBalance } from '@/types';

// Cetus package IDs for Sui mainnet
const CETUS_CONFIG = {
  mainnet: {
    clmmPackageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
    globalConfigId: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4437403f9e9016c',
    globalVaultId: '0xceab84acf6bf90f4f7c9d1375fe35842b8e7e7146e2f7e5f32e4e7e4e0e4e4e',
  },
  testnet: {
    clmmPackageId: '0x1eabed72c53feb3805120a081dc15963c204dc8d091542592abaf7a35689b2fb',
    globalConfigId: '0xdaa46292632c3c4d8f31f23ea0f9b36a28ff3677e9684980e4437403f9e9016c',
    globalVaultId: '0xceab84acf6bf90f4f7c9d1375fe35842b8e7e7146e2f7e5f32e4e7e4e0e4e4e',
  }
};

export class CetusService {
  private sdk: CetusClmmSDK;
  private client: SuiClient;
  private network: 'mainnet' | 'testnet';
  private senderAddress: string | null = null;

  constructor(network: 'mainnet' | 'testnet' = 'mainnet', senderAddress?: string) {
    this.network = network;
    this.senderAddress = senderAddress || null;
    
    this.sdk = initCetusSDK({
      network,
      wallet: senderAddress,
    });

    const nodeUrl = network === 'mainnet' 
      ? 'https://fullnode.mainnet.sui.io:443'
      : 'https://fullnode.testnet.sui.io:443';
    
    this.client = new SuiClient({ url: nodeUrl });
    
    if (senderAddress) {
      this.sdk.senderAddress = senderAddress;
    }
  }

  setSenderAddress(address: string) {
    this.senderAddress = address;
    this.sdk.senderAddress = address;
  }

  getSDK(): CetusClmmSDK {
    return this.sdk;
  }

  getClient(): SuiClient {
    return this.client;
  }

  // Fetch pool information by pool ID
  async getPoolInfo(poolId: string): Promise<PoolInfo | null> {
    try {
      const pool = await this.sdk.Pool.getPool(poolId);
      if (!pool) return null;

      // Access pool properties using snake_case as per SDK
      const coinTypeA = (pool as any).coin_type_a;
      const coinTypeB = (pool as any).coin_type_b;
      const tickSpacing = (pool as any).tick_spacing;
      const feeRate = (pool as any).fee_rate;
      const currentTickIndex = (pool as any).current_tick_index;
      const currentSqrtPrice = (pool as any).current_sqrt_price;
      const liquidity = (pool as any).liquidity;

      // Get token metadata
      const [metadataA, metadataB] = await Promise.all([
        this.getCoinMetadata(coinTypeA),
        this.getCoinMetadata(coinTypeB)
      ]);

      // Calculate current price from sqrt price
      const sqrtPriceNum = Number(currentSqrtPrice) / Math.pow(2, 64);
      const currentPrice = (sqrtPriceNum * sqrtPriceNum).toString();

      return {
        id: poolId,
        coinTypeA,
        coinTypeB,
        tickSpacing,
        feeRate,
        currentTick: currentTickIndex,
        currentPrice,
        sqrtPrice: currentSqrtPrice.toString(),
        liquidity: liquidity.toString(),
        tokenDecimalsA: metadataA?.decimals || 9,
        tokenDecimalsB: metadataB?.decimals || 9,
        symbolA: metadataA?.symbol || 'TOKEN_A',
        symbolB: metadataB?.symbol || 'TOKEN_B',
      };
    } catch (error) {
      console.error('Error fetching pool info:', error);
      return null;
    }
  }

  // Fetch liquidity position by position ID
  async getPosition(positionId: string): Promise<LiquidityPosition | null> {
    try {
      const position = await this.sdk.Position.getPositionById(positionId);
      if (!position) return null;

      // Access position properties using snake_case as per SDK
      const poolId = (position as any).pool;
      const tickLowerIndex = (position as any).tick_lower_index;
      const tickUpperIndex = (position as any).tick_upper_index;
      const liquidity = (position as any).liquidity;
      const feeGrowthInsideA = (position as any).fee_growth_inside_a;
      const feeGrowthInsideB = (position as any).fee_growth_inside_b;

      const poolInfo = await this.getPoolInfo(poolId);
      if (!poolInfo) return null;

      // Calculate amounts from liquidity and price range
      const liquidityBN = new BN(liquidity.toString());
      const sqrtPriceLower = this.tickToSqrtPrice(tickLowerIndex);
      const sqrtPriceUpper = this.tickToSqrtPrice(tickUpperIndex);
      const sqrtPriceCurrent = new BN(poolInfo.sqrtPrice);

      const { amountA, amountB } = this.calculateTokenAmounts(
        liquidityBN,
        sqrtPriceCurrent,
        sqrtPriceLower,
        sqrtPriceUpper
      );

      return {
        id: positionId,
        poolId,
        coinTypeA: poolInfo.coinTypeA,
        coinTypeB: poolInfo.coinTypeB,
        amountA: amountA.toString(),
        amountB: amountB.toString(),
        tickLower: tickLowerIndex,
        tickUpper: tickUpperIndex,
        currentTick: poolInfo.currentTick,
        currentPrice: poolInfo.currentPrice,
        sqrtPrice: poolInfo.sqrtPrice,
        liquidity: liquidity.toString(),
        feeGrowthGlobalA: feeGrowthInsideA.toString(),
        feeGrowthGlobalB: feeGrowthInsideB.toString(),
        tokenDecimalsA: poolInfo.tokenDecimalsA,
        tokenDecimalsB: poolInfo.tokenDecimalsB,
        symbolA: poolInfo.symbolA,
        symbolB: poolInfo.symbolB,
      };
    } catch (error) {
      console.error('Error fetching position:', error);
      return null;
    }
  }

  // Check if price is out of range
  isPriceOutOfRange(position: LiquidityPosition): boolean {
    const currentTick = position.currentTick;
    return currentTick < position.tickLower || currentTick > position.tickUpper;
  }

  // Calculate new tick range centered around current price
  calculateNewTickRange(
    currentTick: number,
    tickSpacing: number,
    rangeWidthPercent: number
  ): { tickLower: number; tickUpper: number } {
    // Convert percentage to price ratio
    const priceRatio = 1 + (rangeWidthPercent / 100);
    
    // Calculate tick range (tick = log_1.0001(price))
    const tickRange = Math.round(Math.log(priceRatio) / Math.log(1.0001));
    
    // Ensure ticks are aligned with tick spacing
    const halfRange = Math.round(tickRange / 2);
    const tickLower = Math.floor((currentTick - halfRange) / tickSpacing) * tickSpacing;
    const tickUpper = Math.ceil((currentTick + halfRange) / tickSpacing) * tickSpacing;

    return { tickLower, tickUpper };
  }

  // Rebalance position - remove liquidity and add to new range
  async rebalancePosition(
    positionId: string,
    config: RebalanceConfig
  ): Promise<RebalanceResult> {
    if (!this.senderAddress) {
      return { success: false, error: 'Wallet not connected' };
    }

    try {
      // Get current position
      const position = await this.getPosition(positionId);
      if (!position) {
        return { success: false, error: 'Position not found' };
      }

      // Check if rebalance is needed
      if (!this.isPriceOutOfRange(position)) {
        return { success: false, error: 'Price is still within range' };
      }

      const poolInfo = await this.getPoolInfo(position.poolId);
      if (!poolInfo) {
        return { success: false, error: 'Pool not found' };
      }

      // Calculate new range
      const { tickLower, tickUpper } = this.calculateNewTickRange(
        poolInfo.currentTick,
        poolInfo.tickSpacing,
        config.rangeWidthPercent
      );

      // Create transaction
      const tx = new Transaction();
      tx.setGasBudget(config.gasBudget);

      // Step 1: Remove liquidity from current position
      await this.buildRemoveLiquidityTx(
        tx,
        positionId,
        position.poolId,
        position.liquidity
      );

      // Step 2: Add liquidity to new range
      await this.buildAddLiquidityTx(
        tx,
        position.poolId,
        position.coinTypeA,
        position.coinTypeB,
        position.amountA,
        position.amountB,
        tickLower,
        tickUpper,
        config.slippageTolerance
      );

      // Execute transaction
      const result = await this.client.signAndExecuteTransaction({
        transaction: tx,
        signer: this.getSigner(), // This needs to be implemented based on wallet type
      });

      await this.client.waitForTransaction({ digest: result.digest });

      return {
        success: true,
        txHash: result.digest,
        gasCost: result.effects?.gasUsed?.computationCost || '0',
        newTickLower: tickLower,
        newTickUpper: tickUpper,
      };
    } catch (error) {
      console.error('Rebalance error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error during rebalance',
      };
    }
  }

  // Build remove liquidity transaction
  private async buildRemoveLiquidityTx(
    tx: Transaction,
    positionId: string,
    poolId: string,
    liquidity: string
  ): Promise<void> {
    const config = CETUS_CONFIG[this.network];
    
    // Call remove_liquidity function
    tx.moveCall({
      target: `${config.clmmPackageId}::pool::remove_liquidity`,
      arguments: [
        tx.object(config.globalConfigId),
        tx.object(poolId),
        tx.object(positionId),
        tx.pure.u128(liquidity), // Remove all liquidity
        tx.pure.u64(0), // Min amount A (0 for now, will be calculated)
        tx.pure.u64(0), // Min amount B (0 for now, will be calculated)
      ],
    });
  }

  // Build add liquidity transaction
  private async buildAddLiquidityTx(
    tx: Transaction,
    poolId: string,
    coinTypeA: string,
    coinTypeB: string,
    amountA: string,
    amountB: string,
    tickLower: number,
    tickUpper: number,
    slippageTolerance: number
  ): Promise<void> {
    const config = CETUS_CONFIG[this.network];

    // Calculate min amounts with slippage
    const minAmountA = new BN(amountA).times(1 - slippageTolerance / 100).toFixed(0);
    const minAmountB = new BN(amountB).times(1 - slippageTolerance / 100).toFixed(0);

    // Create position and add liquidity
    // Serialize i32 values manually (little-endian 4 bytes)
    const tickLowerBytes = new Uint8Array(4);
    const tickUpperBytes = new Uint8Array(4);
    const tickLowerView = new DataView(tickLowerBytes.buffer);
    const tickUpperView = new DataView(tickUpperBytes.buffer);
    tickLowerView.setInt32(0, tickLower, true);
    tickUpperView.setInt32(0, tickUpper, true);
    
    tx.moveCall({
      target: `${config.clmmPackageId}::pool::open_position`,
      typeArguments: [coinTypeA, coinTypeB],
      arguments: [
        tx.object(config.globalConfigId),
        tx.object(poolId),
        tx.pure(tickLowerBytes),
        tx.pure(tickUpperBytes),
      ],
    });

    // Add liquidity to the new position
    tx.moveCall({
      target: `${config.clmmPackageId}::pool::add_liquidity`,
      typeArguments: [coinTypeA, coinTypeB],
      arguments: [
        tx.object(config.globalConfigId),
        tx.object(poolId),
        tx.object(''), // New position ID (will be from previous call)
        tx.pure.u64(amountA),
        tx.pure.u64(amountB),
        tx.pure.u64(minAmountA),
        tx.pure.u64(minAmountB),
      ],
    });
  }

  // Calculate token amounts from liquidity
  private calculateTokenAmounts(
    liquidity: BN,
    sqrtPriceCurrent: BN,
    sqrtPriceLower: BN,
    sqrtPriceUpper: BN
  ): { amountA: BN; amountB: BN } {
    let amountA = new BN(0);
    let amountB = new BN(0);

    if (sqrtPriceCurrent.lt(sqrtPriceLower)) {
      // Current price is below range - all in token A
      amountA = liquidity
        .times(sqrtPriceUpper.minus(sqrtPriceLower))
        .div(sqrtPriceUpper.times(sqrtPriceLower));
    } else if (sqrtPriceCurrent.gt(sqrtPriceUpper)) {
      // Current price is above range - all in token B
      amountB = liquidity.times(sqrtPriceUpper.minus(sqrtPriceLower));
    } else {
      // Current price is within range
      amountA = liquidity
        .times(sqrtPriceUpper.minus(sqrtPriceCurrent))
        .div(sqrtPriceUpper.times(sqrtPriceCurrent));
      amountB = liquidity.times(sqrtPriceCurrent.minus(sqrtPriceLower));
    }

    return { amountA, amountB };
  }

  // Convert tick to sqrt price
  private tickToSqrtPrice(tick: number): BN {
    // sqrtPrice = 1.0001^(tick/2)
    const price = Math.pow(1.0001, tick);
    const sqrtPrice = Math.sqrt(price);
    // Convert to Q64.64 format (multiply by 2^64)
    return new BN(sqrtPrice * Math.pow(2, 64));
  }

  // Get coin metadata
  private async getCoinMetadata(coinType: string): Promise<{ symbol: string; decimals: number } | null> {
    try {
      const metadata = await this.client.getCoinMetadata({ coinType });
      if (!metadata) return null;
      return {
        symbol: metadata.symbol,
        decimals: metadata.decimals,
      };
    } catch (error) {
      console.error('Error fetching coin metadata:', error);
      return null;
    }
  }

  // Get token balances for address
  async getTokenBalances(address: string): Promise<TokenBalance[]> {
    try {
      const balances = await this.client.getAllBalances({ owner: address });
      
      const tokenBalances: TokenBalance[] = [];
      for (const balance of balances) {
        const metadata = await this.getCoinMetadata(balance.coinType);
        tokenBalances.push({
          coinType: balance.coinType,
          symbol: metadata?.symbol || 'UNKNOWN',
          decimals: metadata?.decimals || 9,
          balance: balance.totalBalance,
        });
      }
      
      return tokenBalances;
    } catch (error) {
      console.error('Error fetching token balances:', error);
      return [];
    }
  }

  // Get all positions for an address
  async getPositionsByOwner(): Promise<LiquidityPosition[]> {
    try {
      // Note: The SDK method might be different, using getPositionById as fallback
      // In a real implementation, you'd use the correct SDK method
      const positions: LiquidityPosition[] = [];
      return positions;
    } catch (error) {
      console.error('Error fetching positions:', error);
      return [];
    }
  }

  // This is a placeholder - actual implementation depends on wallet integration
  private getSigner(): any {
    // This should return the wallet signer
    // Implementation depends on the wallet adapter used
    throw new Error('Wallet signer not implemented');
  }
}

// Singleton instance
let cetusServiceInstance: CetusService | null = null;

export const getCetusService = (network?: 'mainnet' | 'testnet', senderAddress?: string): CetusService => {
  if (!cetusServiceInstance || (network && senderAddress)) {
    cetusServiceInstance = new CetusService(network, senderAddress);
  }
  return cetusServiceInstance;
};
