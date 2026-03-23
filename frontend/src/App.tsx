import { useState } from 'react';
import { Header } from './components/Header';
import { VideoPanel } from './components/VideoPanel';
import { CommandConsole } from './components/CommandConsole';

function App() {
  const [isPaused, setIsPaused] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 text-white">
      <Header />

      <main className="flex-1 flex flex-col lg:flex-row min-h-0 p-4 gap-4">
        <div className="flex-1 min-w-0 flex flex-col min-h-[300px] lg:min-h-0">
          <VideoPanel
            isPaused={isPaused}
            onPause={() => setIsPaused((p) => !p)}
          />
        </div>
        <div className="w-full lg:w-auto lg:min-w-[380px] flex-shrink-0 h-[400px] lg:h-auto">
          <CommandConsole />
        </div>
      </main>
    </div>
  );
}

export default App;
