import { Dashboard } from '@/sections/Dashboard';
import { getWalletService } from '@/services/walletService';
import { getCetusService } from '@/services/cetusService';
import { Toaster } from '@/components/ui/sonner';

function App() {
  const walletService = getWalletService('mainnet');
  const cetusService = getCetusService('mainnet');

  return (
    <>
      <Dashboard walletService={walletService} cetusService={cetusService} />
      <Toaster />
    </>
  );
}

export default App;
