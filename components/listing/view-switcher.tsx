import Link from "next/link";
import { VIEWS, listingHref, type ViewId } from "../../lib/listing";

// Plain links, not buttons: each view is its own URL, so a proposal can be shared or bookmarked.
// Switching view keeps the current page.
export function ViewSwitcher({ view, page }: { view: ViewId; page: number }) {
  return (
    <nav className="view-switcher" aria-label="Listing style">
      <span className="view-switcher-label">View</span>
      <ul>
        {VIEWS.map((v) => (
          <li key={v.id}>
            <Link href={listingHref(v.id, page)} aria-current={v.id === view ? "page" : undefined} scroll={false}>
              {v.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
