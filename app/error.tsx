"use client";

// Last-resort page for a failed server render, so a visitor sees this instead of a bare 500.
// listProjects/getProject already fall back to fixtures when the API sleeps; this catches the rest.
export default function ErrorPage() {
  return (
    <main className="listing">
      <h1>SERVER ERROR</h1>
      <p>The server could not build this page just now. The data service may still be waking up.</p>
      <hr />
      <p>
        {/* A plain link (full reload) rather than reset(): reset re-renders the same failed tree. */}
        <a href="">Try again</a> | <a href="/">Back to the Project Index</a>
      </p>
    </main>
  );
}
