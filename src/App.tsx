import { useState } from 'react';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { UpdateBanner } from './ui/Update';
import { Title } from './ui/Screens';
import { Game } from './ui/Game';
import type { ScenarioDef } from './game/types';

type Screen = { kind: 'title' } | { kind: 'game'; scenario: ScenarioDef; run: number };

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });
  return (
    <ErrorBoundary>
      {screen.kind === 'title' ? (
        <Title onPlay={(scenario) => setScreen({ kind: 'game', scenario, run: Date.now() })} />
      ) : (
        <Game
          key={screen.run}
          scenario={screen.scenario}
          onQuit={() => setScreen({ kind: 'title' })}
          onAgain={() => setScreen({ kind: 'game', scenario: screen.scenario, run: Date.now() })}
        />
      )}
      <UpdateBanner />
    </ErrorBoundary>
  );
}
