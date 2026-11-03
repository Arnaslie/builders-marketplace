import Link from "next/link";
import { listingHref } from "../../lib/listing";

type Props = { page: number; totalPages: number; total: number; pageSize: number };

// Pager in 1994 style: a bracketed row of plain underlined links, the current page in bold and
// unlinked. Unavailable Previous/Next render as plain text, so Tab only lands on real links and
// the visual order matches the Tab order. Words wrap naturally on narrow screens.
export function Pagination({ page, totalPages, total, pageSize }: Props) {
  if (totalPages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  return (
    <nav className="pagination" aria-label="Pages">
      <p>
        Projects {first}-{last} of {total}.
      </p>
      <p className="pagination-row">
        [{" "}
        {page > 1 ? (
          <Link href={listingHref(page - 1)} rel="prev">
            Previous Page
          </Link>
        ) : (
          <span className="pagination-off">Previous Page</span>
        )}{" "}
        |{" "}
        {pages.map((n) => (
          <span key={n}>
            {n === page ? (
              <b aria-current="page">{n}</b>
            ) : (
              <Link href={listingHref(n)} aria-label={`Page ${n}`}>
                {n}
              </Link>
            )}{" "}
          </span>
        ))}
        |{" "}
        {page < totalPages ? (
          <Link href={listingHref(page + 1)} rel="next">
            Next Page
          </Link>
        ) : (
          <span className="pagination-off">Next Page</span>
        )}{" "}
        ]
      </p>
    </nav>
  );
}
