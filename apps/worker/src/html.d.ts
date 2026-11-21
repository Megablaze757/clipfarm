// Wrangler bundles .html imports as plain text (its default "Text" module rule).
declare module "*.html" {
  const text: string;
  export default text;
}
