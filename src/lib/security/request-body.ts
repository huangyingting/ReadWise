/**
 * Reads a request body as UTF-8 text without buffering more than `maxBytes`.
 * Returns null when the body is too large: a declared Content-Length over the
 * cap is refused before reading, and streamed bytes are counted so chunked
 * bodies cannot bypass it. A missing body reads as "".
 */
export async function readBoundedText(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
