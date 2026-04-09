declare module 'rtf-parser' {
  interface RTFDocument {
    content: RTFNode[];
  }

  interface RTFNode {
    value?: string;
    content?: RTFNode[];
  }

  type Callback = (err: Error | null, doc: RTFDocument) => void;

  function stream(input: NodeJS.ReadableStream, cb: Callback): void;
  function string(input: string, cb: Callback): void;

  export default { stream, string };
}
