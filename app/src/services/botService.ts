import { CetusService } from './cetusService';
import type { LiquidityPosition, RebalanceConfig, BotState, RebalanceResult } from '@/types';

export class BotService {
  private cetusService: CetusService;
  private config: RebalanceConfig;
  private state: BotState;
  private monitoringInterval: NodeJS.Timeout | null = null;
  private positionId: string | null = null;
  private onStatusUpdate: ((status: string) => void) | null = null;
  private onRebalance: ((result: RebalanceResult) => void) | null = null;

  constructor(
    cetusService: CetusService,
    config: RebalanceConfig,
    callbacks?: {
      onStatusUpdate?: (status: string) => void;
      onRebalance?: (result: RebalanceResult) => void;
    }
  ) {
    this.cetusService = cetusService;
    this.config = config;
    this.state = {
      isRunning: false,
      lastRebalanceTime: null,
      rebalanceCount: 0,
      totalGasSpent: '0',
      errors: [],
    };

    if (callbacks?.onStatusUpdate) {
      this.onStatusUpdate = callbacks.onStatusUpdate;
    }
    if (callbacks?.onRebalance) {
      this.onRebalance = callbacks.onRebalance;
    }
  }

  // Start monitoring a position
  async startMonitoring(positionId: string, checkIntervalMs: number = 30000): Promise<void> {
    if (this.state.isRunning) {
      throw new Error('Bot is already running');
    }

    this.positionId = positionId;
    this.state.isRunning = true;
    this.logStatus('Bot started monitoring position: ' + positionId);

    // Initial check
    await this.checkAndRebalance();

    // Set up interval for continuous monitoring
    this.monitoringInterval = setInterval(async () => {
      await this.checkAndRebalance();
    }, checkIntervalMs);
  }

  // Stop monitoring
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.state.isRunning = false;
    this.logStatus('Bot stopped monitoring');
  }

  // Check position and rebalance if needed
  private async checkAndRebalance(): Promise<void> {
    if (!this.positionId) {
      this.logError('No position ID set');
      return;
    }

    try {
      // Fetch current position state
      const position = await this.cetusService.getPosition(this.positionId);
      if (!position) {
        this.logError('Position not found: ' + this.positionId);
        return;
      }

      // Check if price is out of range
      const isOutOfRange = this.cetusService.isPriceOutOfRange(position);
      
      if (isOutOfRange) {
        this.logStatus(`Price out of range! Current tick: ${position.currentTick}, Range: [${position.tickLower}, ${position.tickUpper}]`);
        
        // Check if enough time has passed since last rebalance
        if (this.canRebalance()) {
          await this.executeRebalance();
        } else {
          this.logStatus('Waiting for minimum rebalance interval...');
        }
      } else {
        this.logStatus(`Price in range. Current tick: ${position.currentTick}, Range: [${position.tickLower}, ${position.tickUpper}]`);
      }
    } catch (error) {
      this.logError('Error during check: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  // Check if enough time has passed since last rebalance
  private canRebalance(): boolean {
    if (!this.state.lastRebalanceTime) return true;
    
    const timeSinceLastRebalance = Date.now() - this.state.lastRebalanceTime;
    return timeSinceLastRebalance >= this.config.minRebalanceInterval * 1000;
  }

  // Execute rebalance
  private async executeRebalance(): Promise<void> {
    if (!this.positionId) return;

    this.logStatus('Executing rebalance...');

    try {
      const result = await this.cetusService.rebalancePosition(this.positionId, this.config);
      
      if (result.success) {
        this.state.lastRebalanceTime = Date.now();
        this.state.rebalanceCount++;
        if (result.gasCost) {
          this.state.totalGasSpent = (BigInt(this.state.totalGasSpent) + BigInt(result.gasCost)).toString();
        }
        this.logStatus(`Rebalance successful! Tx: ${result.txHash}`);
        
        // Update position ID if new position was created
        if (result.newPositionId) {
          this.positionId = result.newPositionId;
        }
      } else {
        this.logError('Rebalance failed: ' + result.error);
      }

      if (this.onRebalance) {
        this.onRebalance(result);
      }
    } catch (error) {
      this.logError('Error during rebalance: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  }

  // Get current bot state
  getState(): BotState {
    return { ...this.state };
  }

  // Update configuration
  updateConfig(newConfig: Partial<RebalanceConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logStatus('Configuration updated');
  }

  // Get current configuration
  getConfig(): RebalanceConfig {
    return { ...this.config };
  }

  // Get monitored position ID
  getPositionId(): string | null {
    return this.positionId;
  }

  // Manual trigger rebalance
  async triggerRebalance(): Promise<RebalanceResult> {
    if (!this.positionId) {
      return { success: false, error: 'No position being monitored' };
    }

    this.logStatus('Manual rebalance triggered');
    const result = await this.cetusService.rebalancePosition(this.positionId, this.config);
    
    if (result.success) {
      this.state.lastRebalanceTime = Date.now();
      this.state.rebalanceCount++;
      if (result.gasCost) {
        this.state.totalGasSpent = (BigInt(this.state.totalGasSpent) + BigInt(result.gasCost)).toString();
      }
    }

    if (this.onRebalance) {
      this.onRebalance(result);
    }

    return result;
  }

  // Fetch detailed position info
  async getPositionInfo(): Promise<LiquidityPosition | null> {
    if (!this.positionId) return null;
    return await this.cetusService.getPosition(this.positionId);
  }

  // Check if rebalance is needed (without executing)
  async checkRebalanceNeeded(): Promise<{ needed: boolean; reason?: string }> {
    if (!this.positionId) {
      return { needed: false, reason: 'No position being monitored' };
    }

    const position = await this.cetusService.getPosition(this.positionId);
    if (!position) {
      return { needed: false, reason: 'Position not found' };
    }

    const isOutOfRange = this.cetusService.isPriceOutOfRange(position);
    
    if (!isOutOfRange) {
      return { 
        needed: false, 
        reason: `Price in range. Current: ${position.currentTick}, Range: [${position.tickLower}, ${position.tickUpper}]` 
      };
    }

    if (!this.canRebalance()) {
      const waitTime = Math.ceil(
        (this.config.minRebalanceInterval * 1000 - (Date.now() - (this.state.lastRebalanceTime || 0))) / 1000
      );
      return { needed: false, reason: `Waiting ${waitTime}s for min rebalance interval` };
    }

    return { 
      needed: true, 
      reason: `Price out of range! Current: ${position.currentTick}, Range: [${position.tickLower}, ${position.tickUpper}]` 
    };
  }

  // Logging helpers
  private logStatus(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
    
    if (this.onStatusUpdate) {
      this.onStatusUpdate(logMessage);
    }
  }

  private logError(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ERROR: ${message}`;
    console.error(logMessage);
    this.state.errors.push(logMessage);
    
    // Keep only last 100 errors
    if (this.state.errors.length > 100) {
      this.state.errors.shift();
    }
    
    if (this.onStatusUpdate) {
      this.onStatusUpdate(logMessage);
    }
  }
}

// Factory function
export const createBotService = (
  cetusService: CetusService,
  config: RebalanceConfig,
  callbacks?: {
    onStatusUpdate?: (status: string) => void;
    onRebalance?: (result: RebalanceResult) => void;
  }
): BotService => {
  return new BotService(cetusService, config, callbacks);
};
