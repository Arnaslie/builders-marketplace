// AG Grid Enterprise licence key, read on the server (app/projects/[slug]/page.tsx) and passed to
// the client grid as a prop. AG Grid checks the key in the browser, so it is shipped there by
// design and is not a secret (.env.example). Blank or whitespace-only means "no licence": the page
// then renders the Community grid, and no ag-grid-enterprise code is downloaded.
export function normalizeLicenseKey(raw: string | null | undefined): string | undefined {
  const key = raw?.trim();
  return key ? key : undefined;
}

export const agGridLicenseKey = (): string | undefined => normalizeLicenseKey(process.env.AG_GRID_LICENSE_KEY);