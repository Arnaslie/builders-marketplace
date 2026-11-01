import Link from "next/link";
import { listingHref, type ViewId } from "../../lib/listing";

type Props = { view: ViewId; page: number; totalPages: number; total: number; pageSize: number };

// Numbered pager. Disabled prev/next render as spans (not dead links) so they are skipped by Tab.
// Prev/next are arrows with full aria-labels so all seven items fit one row on a 360px phone,
// keeping visual order identical to Tab order.
export function Pagination({ view, page, totalPages, total, pageSize }: Props) {
  if (totalPages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav className="pagination" aria-label="Pages">
      <p className="pagination-status">
        Projects {first}-{last} of {total}
      </p>
      <ul>
        <li>
          {page > 1 ? (
            <Link href={listingHref(view, page - 1)} rel="prev" className="pagination-step" aria-label="Previous page">
              ‹
            </Link>
          ) : (
            <span className="pagination-step" aria-disabled="true" aria-hidden="true">
              ‹
            </span>
          )}
        </li>
        {pages.map((n) => (
          <li key={n}>
            <Link
              href={listingHref(view, n)}
              className="pagination-page"
              aria-current={n === page ? "page" : undefined}
              aria-label={`Page ${n}`}
            >
              {n}
            </Link>
          </li>
        ))}
        <li>
          {page < totalPages ? (
            <Link href={listingHref(view, page + 1)} rel="next" className="pagination-step" aria-label="Next page">
              ›
            </Link>
          ) : (
            <span className="pagination-step" aria-disabled="true" aria-hidden="true">
              ›
            </span>
          )}
        </li>
      </ul>
    </nav>
  );
}
