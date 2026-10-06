import { ErrorBoundary } from './ui/ErrorBoundary';
import { UpdateBanner } from './ui/Update';
import { BUILD_NAME } from './version';

export default function App() {
  return (
    <ErrorBoundary>
      <div className="screen">
        <h1>Raide</h1>
        <p className="small">{BUILD_NAME}</p>
      </div>
      <UpdateBanner />
    </ErrorBoundary>
  );
}
