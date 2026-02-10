import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { 
  Play, 
  Pause, 
  RefreshCw, 
  Wallet, 
  Activity, 
  AlertCircle,
  CheckCircle2,
  Settings,
  LogOut,
  ExternalLink
} from 'lucide-react';
import { BotService } from '@/services/botService';
import { CetusService } from '@/services/cetusService';
import { WalletService } from '@/services/walletService';
import type { LiquidityPosition, RebalanceConfig, RebalanceResult, BotState } from '@/types';

interface DashboardProps {
  walletService: WalletService;
  cetusService: CetusService;
}

export function Dashboard({ walletService, cetusService }: DashboardProps) {
  // Connection state
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [suiBalance, setSuiBalance] = useState('0');

  // Position state
  const [positionId, setPositionId] = useState('');
  const [position, setPosition] = useState<LiquidityPosition | null>(null);
  const [isLoadingPosition, setIsLoadingPosition] = useState(false);

  // Bot state
  const [botService, setBotService] = useState<BotService | null>(null);
  const [botState, setBotState] = useState<BotState | null>(null);
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  // Config state
  const [config, setConfig] = useState<RebalanceConfig>({
    slippageTolerance: 0.5,
    rangeWidthPercent: 10,
    minRebalanceInterval: 300, // 5 minutes
    gasBudget: 100000000, // 0.1 SUI
    autoRebalance: true,
  });

  // UI state
  const [showConfig, setShowConfig] = useState(false);
  const [lastRebalanceResult, setLastRebalanceResult] = useState<RebalanceResult | null>(null);
  const [rebalanceCheck, setRebalanceCheck] = useState<{ needed: boolean; reason?: string } | null>(null);

  // Initialize wallet connection
  useEffect(() => {
    const initWallet = async () => {
      walletService.setCallbacks({
        onConnect: (address) => {
          setIsConnected(true);
          setWalletAddress(address);
          cetusService.setSenderAddress(address);
          addLog(`Wallet connected: ${address.slice(0, 6)}...${address.slice(-4)}`);
        },
        onDisconnect: () => {
          setIsConnected(false);
          setWalletAddress(null);
          addLog('Wallet disconnected');
        },
      });
    };
    initWallet();
  }, [walletService, cetusService]);

  // Update SUI balance periodically
  useEffect(() => {
    if (!isConnected) return;

    const updateBalance = async () => {
      const balance = await walletService.getSuiBalance();
      setSuiBalance(balance);
    };

    updateBalance();
    const interval = setInterval(updateBalance, 30000);
    return () => clearInterval(interval);
  }, [isConnected, walletService]);

  // Add log message
  const addLog = useCallback((message: string) => {
    setLogs(prev => {
      const newLogs = [message, ...prev];
      return newLogs.slice(0, 100); // Keep last 100 logs
    });
  }, []);

  // Connect wallet
  const handleConnect = async () => {
    const address = await walletService.connect();
    if (address) {
      setIsConnected(true);
      setWalletAddress(address);
      cetusService.setSenderAddress(address);
    }
  };

  // Disconnect wallet
  const handleDisconnect = async () => {
    if (botService?.getState().isRunning) {
      botService.stopMonitoring();
      setIsBotRunning(false);
    }
    await walletService.disconnect();
    setIsConnected(false);
    setWalletAddress(null);
    setBotService(null);
    setPosition(null);
  };

  // Load position
  const handleLoadPosition = async () => {
    if (!positionId.trim()) return;

    setIsLoadingPosition(true);
    addLog(`Loading position: ${positionId}`);

    try {
      const pos = await cetusService.getPosition(positionId.trim());
      if (pos) {
        setPosition(pos);
        addLog(`Position loaded: ${pos.symbolA}/${pos.symbolB}`);
        addLog(`Current range: [${pos.tickLower}, ${pos.tickUpper}]`);
        addLog(`Current tick: ${pos.currentTick}`);
        
        // Check if out of range
        const isOutOfRange = cetusService.isPriceOutOfRange(pos);
        if (isOutOfRange) {
          addLog('⚠️ WARNING: Price is currently OUT OF RANGE!');
        }
      } else {
        addLog('Error: Position not found');
      }
    } catch (error) {
      addLog('Error loading position: ' + (error instanceof Error ? error.message : 'Unknown error'));
    } finally {
      setIsLoadingPosition(false);
    }
  };

  // Initialize bot service
  const initializeBot = () => {
    if (!position) return null;

    const service = new BotService(cetusService, config, {
      onStatusUpdate: (status) => {
        addLog(status);
      },
      onRebalance: (result) => {
        setLastRebalanceResult(result);
        if (result.success) {
          addLog(`✅ Rebalance successful! Tx: ${result.txHash?.slice(0, 16)}...`);
          // Refresh position after rebalance
          handleLoadPosition();
        } else {
          addLog(`❌ Rebalance failed: ${result.error}`);
        }
      },
    });

    setBotService(service);
    return service;
  };

  // Start bot
  const handleStartBot = async () => {
    if (!position) {
      addLog('Error: No position loaded');
      return;
    }

    const service = botService || initializeBot();
    if (!service) return;

    try {
      await service.startMonitoring(position.id, 30000); // Check every 30 seconds
      setIsBotRunning(true);
      setBotState(service.getState());
    } catch (error) {
      addLog('Error starting bot: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  // Stop bot
  const handleStopBot = () => {
    if (botService) {
      botService.stopMonitoring();
      setIsBotRunning(false);
      setBotState(botService.getState());
    }
  };

  // Manual rebalance
  const handleManualRebalance = async () => {
    if (!botService) {
      const service = initializeBot();
      if (!service) return;
    }

    if (botService) {
      addLog('Triggering manual rebalance...');
      const result = await botService.triggerRebalance();
      setLastRebalanceResult(result);
      setBotState(botService.getState());
    }
  };

  // Check rebalance status
  const handleCheckRebalance = async () => {
    if (!botService) {
      const service = initializeBot();
      if (!service) return;
    }

    if (botService) {
      const check = await botService.checkRebalanceNeeded();
      setRebalanceCheck(check);
      addLog(`Rebalance check: ${check.needed ? 'NEEDED' : 'NOT NEEDED'} - ${check.reason}`);
    }
  };

  // Update config
  const handleUpdateConfig = (updates: Partial<RebalanceConfig>) => {
    const newConfig = { ...config, ...updates };
    setConfig(newConfig);
    if (botService) {
      botService.updateConfig(updates);
    }
  };

  // Format SUI amount
  const formatSui = (amount: string): string => {
    return (BigInt(amount) / BigInt(1000000000)).toString();
  };

  // Format token amount with decimals
  const formatToken = (amount: string, decimals: number): string => {
    const value = BigInt(amount);
    const divisor = BigInt(10 ** decimals);
    const integerPart = (value / divisor).toString();
    const fractionalPart = (value % divisor).toString().padStart(decimals, '0');
    return `${integerPart}.${fractionalPart.slice(0, 4)}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Cetus Liquidity Rebalance Bot
            </h1>
            <p className="text-slate-400 mt-1">Automated liquidity position management on Sui Network</p>
          </div>
          <div className="flex items-center gap-4">
            {isConnected ? (
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="border-green-500 text-green-400">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Connected
                </Badge>
                <span className="text-sm text-slate-400">
                  {walletAddress?.slice(0, 6)}...{walletAddress?.slice(-4)}
                </span>
                <span className="text-sm text-slate-400">
                  {formatSui(suiBalance)} SUI
                </span>
                <Button variant="outline" size="sm" onClick={handleDisconnect}>
                  <LogOut className="w-4 h-4 mr-1" />
                  Disconnect
                </Button>
              </div>
            ) : (
              <Button onClick={handleConnect} className="bg-gradient-to-r from-cyan-500 to-blue-600">
                <Wallet className="w-4 h-4 mr-2" />
                Connect Wallet
              </Button>
            )}
          </div>
        </div>

        {/* Main Content */}
        {isConnected ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column - Position & Controls */}
            <div className="space-y-6">
              {/* Position Input */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-lg">Load Position</CardTitle>
                  <CardDescription>Enter your Cetus liquidity position ID</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex gap-2">
                    <Input
                      placeholder="Position ID (0x...)"
                      value={positionId}
                      onChange={(e) => setPositionId(e.target.value)}
                      className="bg-slate-900 border-slate-600"
                    />
                    <Button 
                      onClick={handleLoadPosition} 
                      disabled={isLoadingPosition || !positionId.trim()}
                    >
                      {isLoadingPosition ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        'Load'
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Position Info */}
              {position && (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center justify-between">
                      Position Details
                      {cetusService.isPriceOutOfRange(position) ? (
                        <Badge variant="destructive" className="animate-pulse">OUT OF RANGE</Badge>
                      ) : (
                        <Badge variant="default" className="bg-green-600">IN RANGE</Badge>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-900/50 p-3 rounded-lg">
                        <p className="text-xs text-slate-400">Token Pair</p>
                        <p className="font-semibold">{position.symbolA}/{position.symbolB}</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-lg">
                        <p className="text-xs text-slate-400">Current Price</p>
                        <p className="font-semibold">{formatToken(position.currentPrice, position.tokenDecimalsB)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-slate-900/50 p-3 rounded-lg">
                        <p className="text-xs text-slate-400">{position.symbolA} Amount</p>
                        <p className="font-semibold">{formatToken(position.amountA, position.tokenDecimalsA)}</p>
                      </div>
                      <div className="bg-slate-900/50 p-3 rounded-lg">
                        <p className="text-xs text-slate-400">{position.symbolB} Amount</p>
                        <p className="font-semibold">{formatToken(position.amountB, position.tokenDecimalsB)}</p>
                      </div>
                    </div>
                    <div className="bg-slate-900/50 p-3 rounded-lg">
                      <p className="text-xs text-slate-400">Price Range (Ticks)</p>
                      <p className="font-semibold">[{position.tickLower}, {position.tickUpper}]</p>
                      <p className="text-xs text-slate-500 mt-1">Current Tick: {position.currentTick}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Bot Controls */}
              {position && (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-lg">Bot Controls</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex gap-2">
                      {!isBotRunning ? (
                        <Button 
                          onClick={handleStartBot} 
                          className="flex-1 bg-green-600 hover:bg-green-700"
                          disabled={!config.autoRebalance}
                        >
                          <Play className="w-4 h-4 mr-2" />
                          Start Bot
                        </Button>
                      ) : (
                        <Button 
                          onClick={handleStopBot} 
                          className="flex-1 bg-red-600 hover:bg-red-700"
                        >
                          <Pause className="w-4 h-4 mr-2" />
                          Stop Bot
                        </Button>
                      )}
                      <Button 
                        variant="outline" 
                        onClick={handleManualRebalance}
                        disabled={isBotRunning}
                      >
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Rebalance Now
                      </Button>
                    </div>
                    <Button 
                      variant="outline" 
                      onClick={handleCheckRebalance}
                      className="w-full"
                    >
                      <Activity className="w-4 h-4 mr-2" />
                      Check Status
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Configuration */}
              {position && (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center justify-between">
                      Configuration
                      <Button variant="ghost" size="sm" onClick={() => setShowConfig(!showConfig)}>
                        <Settings className="w-4 h-4" />
                      </Button>
                    </CardTitle>
                  </CardHeader>
                  {showConfig && (
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Slippage Tolerance: {config.slippageTolerance}%</Label>
                        <Slider
                          value={[config.slippageTolerance]}
                          onValueChange={([v]) => handleUpdateConfig({ slippageTolerance: v })}
                          min={0.1}
                          max={5}
                          step={0.1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Range Width: {config.rangeWidthPercent}%</Label>
                        <Slider
                          value={[config.rangeWidthPercent]}
                          onValueChange={([v]) => handleUpdateConfig({ rangeWidthPercent: v })}
                          min={1}
                          max={50}
                          step={1}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Min Rebalance Interval: {config.minRebalanceInterval}s</Label>
                        <Slider
                          value={[config.minRebalanceInterval]}
                          onValueChange={([v]) => handleUpdateConfig({ minRebalanceInterval: v })}
                          min={60}
                          max={3600}
                          step={60}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <Label>Auto Rebalance</Label>
                        <Switch
                          checked={config.autoRebalance}
                          onCheckedChange={(v) => handleUpdateConfig({ autoRebalance: v })}
                        />
                      </div>
                    </CardContent>
                  )}
                </Card>
              )}
            </div>

            {/* Right Column - Stats & Logs */}
            <div className="lg:col-span-2 space-y-6">
              {/* Bot Stats */}
              {botState && (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader>
                    <CardTitle className="text-lg">Bot Statistics</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-4 gap-4">
                      <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                        <p className="text-2xl font-bold text-cyan-400">{botState.rebalanceCount}</p>
                        <p className="text-xs text-slate-400">Rebalances</p>
                      </div>
                      <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                        <p className="text-2xl font-bold text-purple-400">{formatSui(botState.totalGasSpent)}</p>
                        <p className="text-xs text-slate-400">Gas Spent (SUI)</p>
                      </div>
                      <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                        <p className="text-2xl font-bold text-green-400">
                          {botState.lastRebalanceTime 
                            ? new Date(botState.lastRebalanceTime).toLocaleTimeString() 
                            : 'Never'}
                        </p>
                        <p className="text-xs text-slate-400">Last Rebalance</p>
                      </div>
                      <div className="bg-slate-900/50 p-4 rounded-lg text-center">
                        <p className={`text-2xl font-bold ${isBotRunning ? 'text-green-400' : 'text-red-400'}`}>
                          {isBotRunning ? 'Running' : 'Stopped'}
                        </p>
                        <p className="text-xs text-slate-400">Bot Status</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Rebalance Check Result */}
              {rebalanceCheck && (
                <Alert className={rebalanceCheck.needed ? 'bg-yellow-900/50 border-yellow-600' : 'bg-green-900/50 border-green-600'}>
                  <AlertCircle className="w-4 h-4" />
                  <AlertDescription>
                    {rebalanceCheck.needed ? 'Rebalance needed: ' : 'No rebalance needed: '}
                    {rebalanceCheck.reason}
                  </AlertDescription>
                </Alert>
              )}

              {/* Last Rebalance Result */}
              {lastRebalanceResult && (
                <Alert className={lastRebalanceResult.success ? 'bg-green-900/50 border-green-600' : 'bg-red-900/50 border-red-600'}>
                  {lastRebalanceResult.success ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                  <AlertDescription className="flex items-center justify-between">
                    <span>
                      {lastRebalanceResult.success 
                        ? `Rebalance successful! New range: [${lastRebalanceResult.newTickLower}, ${lastRebalanceResult.newTickUpper}]`
                        : `Rebalance failed: ${lastRebalanceResult.error}`
                      }
                    </span>
                    {lastRebalanceResult.txHash && (
                      <a 
                        href={`https://suiscan.xyz/mainnet/tx/${lastRebalanceResult.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-cyan-400 hover:text-cyan-300 flex items-center"
                      >
                        View <ExternalLink className="w-3 h-3 ml-1" />
                      </a>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Logs */}
              <Card className="bg-slate-800/50 border-slate-700">
                <CardHeader>
                  <CardTitle className="text-lg">Activity Log</CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-80 w-full rounded-md border border-slate-700 bg-slate-900/50 p-4">
                    {logs.length === 0 ? (
                      <p className="text-slate-500 text-center">No activity yet...</p>
                    ) : (
                      <div className="space-y-2">
                        {logs.map((log, index) => (
                          <div key={index} className="text-sm font-mono text-slate-300">
                            {log}
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>
            </div>
          </div>
        ) : (
          /* Not Connected State */
          <Card className="bg-slate-800/50 border-slate-700 max-w-2xl mx-auto mt-12">
            <CardContent className="p-12 text-center">
              <div className="w-20 h-20 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
                <Wallet className="w-10 h-10 text-white" />
              </div>
              <h2 className="text-2xl font-bold mb-4">Connect Your Wallet</h2>
              <p className="text-slate-400 mb-8">
                Connect your Sui wallet to start monitoring and rebalancing your Cetus liquidity positions automatically.
              </p>
              <Button 
                onClick={handleConnect}
                className="bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-6 text-lg"
              >
                <Wallet className="w-5 h-5 mr-2" />
                Connect Wallet
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
