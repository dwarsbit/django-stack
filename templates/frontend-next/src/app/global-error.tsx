"use client";

import "./globals.css";

// The page for an error in the root layout, such as when the API does not
// answer. It replaces the layout, so it calls no API and renders its own
// <html>: it still shows when the backend or the database is the problem.
export default function GlobalError() {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong</title>
        <meta name="robots" content="noindex" />
      </head>
      <body>
        <main>
          <section className="narrow">
            <h1>Something went wrong</h1>
            <p>The page could not be shown. Try again in a moment.</p>
            <p>
              <a href="/">Go to the home page</a>
            </p>
          </section>
        </main>
      </body>
    </html>
  );
}
