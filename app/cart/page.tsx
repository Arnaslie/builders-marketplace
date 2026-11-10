import Link from "next/link";
import { notFound } from "next/navigation";
import { PayPalCheckout } from "../../components/paypal-checkout";
import { ApiError, getProject, priceCart, usingApi, type Cart } from "../../lib/api/client";
import { cartRequestFromParams } from "../../lib/cart-link";
import { formatMoney } from "../../lib/money";
import { SAMPLE_CART_NOTE, isMockProject } from "../../lib/mock/ids";

export const metadata = { title: "Cart | DIY Wikipedia" };

// The cart is described by the URL (format in lib/cart-link.ts), so the agent panel can link to
// its exact cart. POST /cart prices it with no LLM call; the same request goes to
// POST /checkout/orders, where the API prices it again and sets the PayPal total itself.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function CartPage({ searchParams }: Props) {
  const params = await searchParams;
  const slug = one(params.project);

  if (!slug) {
    return (
      <main>
        <h1>Cart</h1>
        <p className="lede">
          Your cart is empty. Choose a project from the <Link href="/">Project Index</Link> to build one.
        </p>
      </main>
    );
  }

  if (!usingApi) {
    return (
      <main>
        <h1>Cart</h1>
        <p>
          <b>NOTE:</b> Checkout needs the API server. This copy of the site runs on sample data only
          (NEXT_PUBLIC_API_URL is not set), so the cart cannot be priced and PayPal is not offered.
        </p>
      </main>
    );
  }

  const project = await getProject(slug);
  if (!project) notFound();

  // Mocks are not on the API: pricing would 404 and PayPal must never be offered for one.
  if (isMockProject(project.id)) {
    return (
      <main>
        <h1>Cart</h1>
        <p>
          <b>NOTE:</b> {SAMPLE_CART_NOTE}
        </p>
        <p>
          <Link href={`/projects/${project.slug}`}>Return to {project.title}</Link>
        </p>
      </main>
    );
  }

  const request = cartRequestFromParams(project.id, params);
  const invalidLink = (detail: string) => (
    <main>
      <h1>Cart</h1>
      <p className="error">This cart link is not valid: {detail}</p>
      <p>
        <Link href={`/projects/${project.slug}`}>Return to {project.title}</Link>
      </p>
    </main>
  );
  if (request === null) return invalidLink("the swaps in this link are malformed");

  let cart: Cart;
  try {
    cart = await priceCart(request);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 422) throw error;
    return invalidLink(error.detail);
  }

  return (
    <main>
      <h1>Cart</h1>
      <p>
        For <Link href={`/projects/${project.slug}`}>{project.title}</Link>.{" "}
        {cart.skippedLineIds.length > 0 && <>{cart.skippedLineIds.length} items you already own are left out. </>}
        {cart.swaps.length > 0 && <>{cart.swaps.length} items were swapped for cheaper ones to meet your budget.</>}
      </p>

      {cart.lines.length === 0 ? (
        <p className="lede">Nothing to buy: you already own every item on the list.</p>
      ) : (
        <>
          <table className="cart-table">
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Retailer</th>
                <th scope="col">Qty</th>
                <th scope="col">Unit price</th>
                <th scope="col">Line total</th>
              </tr>
            </thead>
            <tbody>
              {cart.lines.map((line) => (
                <tr key={line.lineId}>
                  <td>
                    {line.name}
                    {line.swapped && <i> (cheaper swap)</i>}
                  </td>
                  <td>
                    {/^https?:\/\//i.test(line.productUrl) ? (
                      <a href={line.productUrl} target="_blank" rel="noopener noreferrer">
                        {line.retailer}
                      </a>
                    ) : (
                      line.retailer
                    )}
                  </td>
                  <td className="num">{line.qty}</td>
                  <td className="num">{formatMoney(line.unitPrice, line.currency)}</td>
                  <td className="num">{formatMoney(line.lineTotal, line.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>
                  Total
                </th>
                <td className="num">
                  <b>{formatMoney(cart.subtotal, cart.currency)}</b>
                </td>
              </tr>
            </tfoot>
          </table>
          {cart.budget && !cart.withinBudget && (
            <p>
              <b>NOTE:</b> Even with every cheaper swap, this cart is over your {formatMoney(cart.budget, cart.currency)}{" "}
              budget.
            </p>
          )}
          <hr />
          <h2>Pay with PayPal</h2>
          <p>
            You pay DIY Wikipedia once for the whole cart. Orders with the individual retailers are simulated for this
            demo; nothing will be shipped.
          </p>
          <PayPalCheckout request={request} />
        </>
      )}
    </main>
  );
}
