import Link from "next/link";
import { buttonVariants } from "@/components/ui/Button";

export default function TagNotFound() {
  return (
    <div className="container">
      <h1>Tag not found</h1>
      <p className="muted">
        We couldn&apos;t find that tag. It may not exist yet or the link is
        incorrect.
      </p>
      <p style={{ marginTop: "1.5rem" }}>
        <Link className={buttonVariants({ variant: "primary" })} href="/dashboard">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
