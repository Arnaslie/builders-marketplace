"use client";

// PayPal Checkout buttons (JavaScript SDK v5, Buttons component). Docs this file follows:
//   Script tag + query params:  https://developer.paypal.com/sdk/js/configuration/
//   Standard integration flow:  https://developer.paypal.com/studio/checkout/standard/integrate
//   Reference app.js (restart on INSTRUMENT_DECLINED):
//     https://github.com/paypal-examples/docs-examples/blob/main/standard-integration/client/html/src/app.js
//
// The buttons are PayPal's own UI. Money never comes from this file: createOrder sends the same
// CartRequest as the cart page, and the API rebuilds the cart and sets the total itself.
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ApiError,
  captureCheckoutOrder,
  createCheckoutOrder,
  getCheckoutConfig,
  type CartRequest,
} from "../lib/api/client";

// The slice of the SDK this component uses. The SDK has no first-party types on window.paypal.
type ButtonsActions = { restart: () => Promise<void> };
type ButtonsOptions = {
  style?: Record<string, string>;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }, actions: ButtonsActions) => Promise<void>;
  onCancel?: () => void;
  onError?: (error: unknown) => void;
};
type ButtonsInstance = { render: (container: HTMLElement) => Promise<void>; close?: () => Promise<void> };
type PayPalNamespace = { Buttons: (options: ButtonsOptions) => ButtonsInstance };

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

// One script per page load. The docs require loading it from www.paypal.com, never bundled.
let sdk: { src: string; promise: Promise<PayPalNamespace> } | null = null;

function loadSdk(clientId: string, currency: string): Promise<PayPalNamespace> {
  const query = new URLSearchParams({ "client-id": clientId, currency, intent: "capture", components: "buttons" });
  const src = `https://www.paypal.com/sdk/js?${query}`;
  if (sdk?.src === src) return sdk.promise;
  const promise = new Promise<PayPalNamespace>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () =>
      window.paypal ? resolve(window.paypal) : reject(new Error("The PayPal SDK loaded but did not start."));
    script.onerror = () => {
      sdk = null; // let a later mount try again
      reject(new Error("Could not load the PayPal SDK from www.paypal.com."));
    };
    document.head.appendChild(script);
  });
  sdk = { src, promise };
  return promise;
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.detail || error.message;
  return error instanceof Error ? error.message : "Unknown error.";
}

type Phase = "loading" | "ready" | "unconfigured" | "failed";

export function PayPalCheckout({ request }: { request: CartRequest }) {
  const router = useRouter();
  const container = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [env, setEnv] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // A string key, so a new request object with the same content does not re-render the buttons.
  const requestKey = JSON.stringify(request);

  useEffect(() => {
    let cancelled = false;
    let buttons: ButtonsInstance | null = null;
    const body = JSON.parse(requestKey) as CartRequest;
    // One key per checkout attempt: PayPal can call createOrder again (a retry, a re-opened
    // popup) and every call must land on the same order, never a second payable one.
    let idempotencyKey: string | null = null;

    (async () => {
      try {
        const config = await getCheckoutConfig();
        if (cancelled) return;
        if (!config) {
          setPhase("unconfigured");
          return;
        }
        setEnv(config.env);
        const paypal = await loadSdk(config.clientId, config.currency);
        if (cancelled || !container.current) return;

        buttons = paypal.Buttons({
          style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal" },
          async createOrder() {
            setMessage(null);
            idempotencyKey ??= crypto.randomUUID();
            try {
              return (await createCheckoutOrder(body, idempotencyKey)).id;
            } catch (error) {
              setMessage(`Could not start PayPal checkout: ${errorText(error)}`);
              throw error;
            }
          },
          async onApprove(data, actions) {
            try {
              const order = await captureCheckoutOrder(data.orderID);
              router.push(`/checkout/success?order=${encodeURIComponent(order.paypalOrderId)}`);
            } catch (error) {
              // Declined funding source: reopen PayPal so the buyer can pick another one.
              if (error instanceof ApiError && error.status === 402) return actions.restart();
              setMessage(`The payment was not completed: ${errorText(error)}`);
            }
          },
          onCancel() {
            setMessage("Payment cancelled. Nothing was charged.");
          },
          onError(error) {
            // createOrder already explained its own failure; keep that message.
            setMessage((current) => current ?? `PayPal reported an error: ${errorText(error)}`);
          },
        });
        await buttons.render(container.current);
        if (!cancelled) setPhase("ready");
      } catch (error) {
        if (!cancelled) {
          setPhase("failed");
          setMessage(errorText(error));
        }
      }
    })();

    return () => {
      cancelled = true;
      buttons?.close?.().catch(() => undefined);
    };
  }, [requestKey, router]);

  return (
    <div id="checkout">
      {env === "sandbox" && (
        <p>
          <b>NOTE:</b> PayPal sandbox. Sign in with a sandbox buyer account; no real money moves.
        </p>
      )}
      {phase === "loading" && <p>Loading PayPal...</p>}
      {phase === "unconfigured" && (
        <p>
          <b>NOTE:</b> PayPal is not configured on the API server, so checkout is unavailable.
        </p>
      )}
      <div ref={container} id="paypal-buttons" className="paypal-buttons" />
      {message && (
        <p className="error" role="alert">
          {message}
        </p>
      )}
    </div>
  );
}
