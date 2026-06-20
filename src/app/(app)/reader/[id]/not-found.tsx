import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";

export default function ArticleNotFound() {
  return (
    <div className="container">
      <h1>Article not found</h1>
      <p className="muted">
        We couldn&apos;t find that article. It may have been removed or the link
        is incorrect.
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <Link className={buttonVariants({ variant: "primary" })} href="/dashboard">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
