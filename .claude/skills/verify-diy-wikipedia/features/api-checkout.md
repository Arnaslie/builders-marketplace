# API checkout stubs and PayPal webhook

`POST /checkout/orders` rebuilds the cart server-side from the same input as build-cart and
returns an order in the PayPal Orders v2 create-order shape. `POST /checkout/orders/{id}/capture`
marks it paid and returns our order record with simulated fulfilment. `POST /webhooks/paypal`
accepts and logs an event. **All three are stubs: no PayPal call happens yet** (TODO for
PAYMENTS ENGINEER).

## Sub-features

- `checkout-create` `201`, `status: CREATED`, `intent: CAPTURE`, 17-char id, amount = server cart subtotal.
- `checkout-capture` `200`, `status: paid`, `fulfilment: simulated`, capture id set; second capture `422`.
- `checkout-errors` unknown order capture `404`; empty cart (everything owned) `422`.
- `paypal-webhook` `200` `{"received":true}` and one log line in the API log.

## How to get to it (user POV)

- The PayPal JS SDK button calls `createOrder` -> our `/checkout/orders`, then `onApprove` ->
  our `/checkout/orders/{orderID}/capture`. PayPal posts webhooks to `/webhooks/paypal`.

## Driving it with verify.sh

Preconditions:

- `$V doctor "$RUN"` exits 0. No PayPal credentials needed while these are stubs.

- **Create.** `$V api "$RUN" POST /checkout/orders api-order-create '{"projectId":"proj-chair","owned":["chair-drill","chair-tape-measure","chair-safety-glasses"]}'`.
  Status `201`; body has `"status":"CREATED"`, `"intent":"CAPTURE"` and
  `"amount":{"currency_code":"USD","value":"250.67"}`.
  `OID=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["id"])' .verify/$RUN/evidence/api-order-create.body)`.
- **Capture.** `$V api "$RUN" POST /checkout/orders/$OID/capture api-order-capture`. Status `200`;
  body has `"status":"paid"`, `"fulfilment":"simulated"`, `"total":"250.67"`, `"paypalOrderId":"<OID>"`.
- **Double capture.** Repeat as `api-order-capture-again`. Status `422`.
- **Unknown order.** `$V api "$RUN" POST /checkout/orders/NOSUCHORDER000000/capture api-order-404`. Status `404`.
- **Empty cart.** `$V api "$RUN" POST /checkout/orders api-order-empty '{"projectId":"proj-knife","owned":["knife-1084-steel","knife-cross-peen-hammer"]}'`. Status `422`.
- **Webhook.** `$V api "$RUN" POST /webhooks/paypal api-webhook '{"id":"WH-VERIFY-1","event_type":"PAYMENT.CAPTURE.COMPLETED"}'`.
  Status `200`, body `{"received":true}`; `grep 'WH-VERIFY-1' .verify/$RUN/state/api.log` prints
  `paypal webhook received: event_type=PAYMENT.CAPTURE.COMPLETED id=WH-VERIFY-1`.
- **Side effects.** None outbound: nothing reads `PAYPAL_CLIENT_ID` yet. When the real PayPal
  calls land, prove the sandbox order exists (GET /v2/checkout/orders/{id} on the sandbox).

## Gotchas

- Orders live in memory: restarting the API forgets them, and the 404 on capture after a restart
  is expected until storage lands.
- The `approve` link points at the sandbox checkout URL with a fake token; it will not load a real
  PayPal page.
- The webhook does not verify signatures yet; never treat a stub webhook as proof of payment.
