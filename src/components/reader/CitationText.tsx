import type { CitationPart } from "@/lib/citations";

/** Renders formatted citation parts, italicizing titles and site names. */
export default function CitationText({ parts }: { parts: CitationPart[] }) {
  return (
    <>
      {parts.map((part, index) => (part.italic ? <i key={index}>{part.text}</i> : <span key={index}>{part.text}</span>))}
    </>
  );
}
