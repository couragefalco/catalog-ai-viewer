import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col justify-center px-6">
      <p className="text-muted-foreground text-sm">AskCatalog for product catalogs</p>
      <h1 className="mt-3 max-w-2xl text-4xl font-semibold tracking-normal">
        Turn a product catalog into a shareable AI assistant.
      </h1>
      <p className="text-muted-foreground mt-4 max-w-2xl text-base">
        Upload a PDF, get a link, and let customers ask grounded questions with
        page citations.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/dashboard"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Upload catalog
        </Link>
        <Link href="/login" className="rounded-md border px-4 py-2 text-sm font-medium">
          Sign in
        </Link>
      </div>
    </main>
  );
}
