// AG Charts Enterprise licence key (AG Studio), read on the server (app/projects/[slug]/page.tsx)
// and passed to the client charts as a prop, the same way AG_GRID_LICENSE_KEY reaches the grid.
// The key is checked in the browser, so it is shipped there by design and is not a secret.
// Blank means "no licence": the charts then run on AG Charts Community and no
// ag-charts-enterprise code is downloaded.
import { normalizeLicenseKey } from "./ag-grid-license";

export const agChartsLicenseKey = (): string | undefined => normalizeLicenseKey(process.env.AG_CHARTS_LICENSE_KEY);
