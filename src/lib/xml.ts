// Linguistic files (EAF, IMDI, FlexText) commonly exceed fast-xml-parser's default
// limit of 1000 entity expansions due to standard XML escaping (&amp;, &lt;, etc.)
// across thousands of annotations
export const MAX_ENTITY_EXPANSIONS = 100_000;
