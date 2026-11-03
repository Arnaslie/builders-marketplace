import Link from "next/link";
import { getCheckoutOrder, usingApi } from "../../../lib/api/client";
import { formatMoney } from "../../../lib/money";

export const metadata = { title: "Order received | DIY Wikipedia" };

// The PayPal buttons send the buyer here after a capture: /checkout/success?order=<PayPal order id>.
// The record is read back from the API, so this page shows what the server stored, not what the
// browser was told.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function CheckoutSuccessPage({ searchParams }: Props) {
  const raw = (await searchParams).order;
  const id = Array.isArray(raw) ? raw[0] : raw;
  const order = usingApi && id ? await getCheckoutOrder(id) : null;

  if (!order) {
    return (
      <main>
        <h1>Order not found</h1>
        <p className="lede">
          No order record to show. The demo API keeps orders in memory, so a server restart forgets them; a payment
          already made is still recorded by PayPal.
        </p>
        <p>
          <Link href="/">Return to the Project Index</Link>
        </p>
      </main>
    );
  }

  const paid = order.status === "paid";
  return (
    <main>
      <h1>{paid ? "Order received" : "Payment not completed"}</h1>
      <p className="lede">Fulfilment simulated for demo</p>
      <table className="cart-table">
        <tbody>
          <tr>
            <th scope="row">Order</th>
            <td>{order.id}</td>
          </tr>
          <tr>
            <th scope="row">Status</th>
            <td>
              <b>{order.status}</b>
            </td>
          </tr>
          <tr>
            <th scope="row">Fulfilment</th>
            <td>{order.fulfilment} (no retailer orders are placed and nothing ships)</td>
          </tr>
          <tr>
            <th scope="row">Total</th>
            <td>{formatMoney(order.total, order.currency)}</td>
          </tr>
          <tr>
            <th scope="row">PayPal order</th>
            <td>
              <code>{order.paypalOrderId}</code>
            </td>
          </tr>
          <tr>
            <th scope="row">PayPal capture</th>
            <td>{order.paypalCaptureId ? <code>{order.paypalCaptureId}</code> : "none"}</td>
          </tr>
        </tbody>
      </table>

      <h2>Items</h2>
      <ul>
        {order.lines.map((line) => (
          <li key={line.lineId}>
            {line.qty} x {line.name} from {line.retailer}: {formatMoney(line.lineTotal, line.currency)}
          </li>
        ))}
      </ul>
      <hr />
      <p>
        <Link href="/">Return to the Project Index</Link>
      </p>
    </main>
  );
}
