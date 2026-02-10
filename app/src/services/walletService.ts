import { SuiClient } from '@mysten/sui/client';
import { Transaction } from '@mysten/sui/transactions';

// Wallet adapter interface
export interface WalletAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getAddress(): string | null;
  isConnected(): boolean;
  signAndExecuteTransaction(transaction: Transaction): Promise<{ digest: string }>;
  getPublicKey(): string | null;
}

// Mock wallet adapter for development (replace with actual wallet adapter)
class MockWalletAdapter implements WalletAdapter {
  private connected = false;
  private address: string | null = null;

  async connect(): Promise<void> {
    // In real implementation, this would connect to actual wallet
    this.connected = true;
    this.address = '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.address = null;
  }

  getAddress(): string | null {
    return this.address;
  }

  isConnected(): boolean {
    return this.connected;
  }

  async signAndExecuteTransaction(_transaction: Transaction): Promise<{ digest: string }> {
    // Mock implementation - replace with actual wallet signing
    return { digest: '0x' + Array(64).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('') };
  }

  getPublicKey(): string | null {
    return this.address;
  }
}

export class WalletService {
  private adapter: WalletAdapter;
  private client: SuiClient;
  private network: 'mainnet' | 'testnet';
  private onConnectCallback: ((address: string) => void) | null = null;
  private onDisconnectCallback: (() => void) | null = null;

  constructor(network: 'mainnet' | 'testnet' = 'mainnet', adapter?: WalletAdapter) {
    this.network = network;
    this.adapter = adapter || new MockWalletAdapter();
    
    const nodeUrl = network === 'mainnet' 
      ? 'https://fullnode.mainnet.sui.io:443'
      : 'https://fullnode.testnet.sui.io:443';
    
    this.client = new SuiClient({ url: nodeUrl });
  }

  // Set callbacks
  setCallbacks(callbacks: {
    onConnect?: (address: string) => void;
    onDisconnect?: () => void;
  }): void {
    if (callbacks.onConnect) this.onConnectCallback = callbacks.onConnect;
    if (callbacks.onDisconnect) this.onDisconnectCallback = callbacks.onDisconnect;
  }

  // Connect wallet
  async connect(): Promise<string | null> {
    try {
      await this.adapter.connect();
      const address = this.adapter.getAddress();
      
      if (address && this.onConnectCallback) {
        this.onConnectCallback(address);
      }
      
      return address;
    } catch (error) {
      console.error('Wallet connection error:', error);
      return null;
    }
  }

  // Disconnect wallet
  async disconnect(): Promise<void> {
    await this.adapter.disconnect();
    if (this.onDisconnectCallback) {
      this.onDisconnectCallback();
    }
  }

  // Check if connected
  isConnected(): boolean {
    return this.adapter.isConnected();
  }

  // Get wallet address
  getAddress(): string | null {
    return this.adapter.getAddress();
  }

  // Get SUI balance
  async getSuiBalance(): Promise<string> {
    const address = this.getAddress();
    if (!address) return '0';

    try {
      const balance = await this.client.getBalance({ owner: address });
      return balance.totalBalance;
    } catch (error) {
      console.error('Error fetching SUI balance:', error);
      return '0';
    }
  }

  // Get all coin balances
  async getAllBalances(): Promise<Array<{ coinType: string; balance: string }>> {
    const address = this.getAddress();
    if (!address) return [];

    try {
      const balances = await this.client.getAllBalances({ owner: address });
      return balances.map(b => ({
        coinType: b.coinType,
        balance: b.totalBalance,
      }));
    } catch (error) {
      console.error('Error fetching balances:', error);
      return [];
    }
  }

  // Sign and execute transaction
  async signAndExecuteTransaction(transaction: Transaction): Promise<{ digest: string } | null> {
    try {
      return await this.adapter.signAndExecuteTransaction(transaction);
    } catch (error) {
      console.error('Transaction error:', error);
      return null;
    }
  }

  // Get SuiClient
  getClient(): SuiClient {
    return this.client;
  }

  // Get network
  getNetwork(): 'mainnet' | 'testnet' {
    return this.network;
  }

  // Switch network
  switchNetwork(network: 'mainnet' | 'testnet'): void {
    if (this.network !== network) {
      this.network = network;
      const nodeUrl = network === 'mainnet' 
        ? 'https://fullnode.mainnet.sui.io:443'
        : 'https://fullnode.testnet.sui.io:443';
      this.client = new SuiClient({ url: nodeUrl });
    }
  }
}

// Singleton instance
let walletServiceInstance: WalletService | null = null;

export const getWalletService = (network?: 'mainnet' | 'testnet'): WalletService => {
  if (!walletServiceInstance || network) {
    walletServiceInstance = new WalletService(network);
  }
  return walletServiceInstance;
};
