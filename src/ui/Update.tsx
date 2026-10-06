import { tr } from '../i18n';
import { useUpdateAvailable, reloadApp, newerVersionName, BUILD_NAME } from '../version';

/** A small banner when a newer build is on the server. */
export function UpdateBanner() {
  const has = useUpdateAvailable();
  if (!has) return null;
  return (
    <div className="update" data-ui>
      <span>
        {tr('Uusi versio', 'New version')}: <b>{newerVersionName()}</b>
        <br />
        <small>
          {tr('Sinulla on', 'You have')} {BUILD_NAME}
        </small>
      </span>
      <button className="btn primary" onClick={reloadApp}>
        {tr('Päivitä', 'Update')}
      </button>
    </div>
  );
}
