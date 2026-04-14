/**
 * Roman Cloze — Automated Regression Tests
 *
 * Tests the two core string transformations:
 *   A) Stripping <i> tags from cloze interior HTML (aiGetText)
 *   B) Conditional re-italicisation on unwrap (unwrapCloze)
 *
 * Run: node tests/test_roman_cloze.js
 */

let passed = 0;
let failed = 0;

function assert(label, actual, expected) {
  if (actual === expected) {
    passed++;
    console.log(`  ✅ ${label}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
    console.log(`     Expected: ${JSON.stringify(expected)}`);
    console.log(`     Actual:   ${JSON.stringify(actual)}`);
  }
}

// =============================================================
// A) ITALIC STRIPPING — mirrors clozeInnerHTML logic in aiGetText
// =============================================================
console.log("\n━━━ Part A: <i> tag stripping for cloze interior ━━━\n");

function stripItalic(html) {
  return html.replace(/<\/?i>/gi, "");
}

// A1: Basic sentence wrapped in <i>
assert(
  "Basic italic sentence",
  stripItalic("<i>Do you believe what he says?</i>"),
  "Do you believe what he says?"
);

// A2: Sentence with no italic (already roman) — no change
assert(
  "Already roman text — unchanged",
  stripItalic("Some plain text here"),
  "Some plain text here"
);

// A3: .del span preserved (uses inline style, not <i> tag)
assert(
  ".del span with inline font-style preserved",
  stripItalic(
    '<i>I like this wine.</i>&nbsp;(not&nbsp;<span class="del" style="font-style: italic;">I\'m liking this wine.</span>)'
  ),
  'I like this wine.&nbsp;(not&nbsp;<span class="del" style="font-style: italic;">I\'m liking this wine.</span>)'
);

// A4: Only the <i> wrapper is stripped — .del span inside leftoverHTML is untouched
//     (In practice leftoverHTML is never inside innerHTML, but testing defensively)
assert(
  ".del span completely untouched by <i> strip",
  stripItalic(
    '<span class="del" style="text-decoration-line: line-through; color: rgb(106, 115, 125); font-style: italic; opacity: 0.85;">Are you believing</span>'
  ),
  '<span class="del" style="text-decoration-line: line-through; color: rgb(106, 115, 125); font-style: italic; opacity: 0.85;">Are you believing</span>'
);

// A5: .pill element preserved
assert(
  ".pill element preserved",
  stripItalic('<i>Some text</i><span class="pill">grammar note</span>'),
  'Some text<span class="pill">grammar note</span>'
);

// A6: Nested bold inside italic
assert(
  "Nested <b> inside <i> — only <i> removed",
  stripItalic("<i><b>bold italic text</b></i>"),
  "<b>bold italic text</b>"
);

// A7: Case-insensitive (handles <I> and </I>)
assert(
  "Case-insensitive <I> stripping",
  stripItalic("<I>Uppercase italic tags</I>"),
  "Uppercase italic tags"
);

// A8: Multiple <i> fragments (partial italic — edge case)
assert(
  "Multiple <i> fragments stripped",
  stripItalic("<i>I've been </i>learning<i> English for years.</i>"),
  "I've been learning English for years."
);

// A9: Empty italic tags
assert(
  "Empty <i></i> removed cleanly",
  stripItalic("Text <i></i> more text"),
  "Text  more text"
);

// =============================================================
// B) CONDITIONAL RE-ITALICISATION — mirrors unwrapCloze logic
// =============================================================
console.log("\n━━━ Part B: Conditional re-italicisation on unwrap ━━━\n");

const unwrapRegex = /\{\{c\d+::(.*?)(?:::.*?)?\}\}/g;

function unwrap(html, ankiFmt) {
  const shouldItalicise = ankiFmt === "1";
  return html.replace(unwrapRegex, shouldItalicise ? "<i>$1</i>" : "$1");
}

// B1: Formatted line (data-anki-fmt="1") — re-italicised
assert(
  "Formatted line — content re-italicised on unwrap",
  unwrap(
    "&nbsp;&nbsp;&nbsp;&nbsp;{{c1::Do you believe what he says?::Вы верите тому, что он говорит?}}",
    "1"
  ),
  "&nbsp;&nbsp;&nbsp;&nbsp;<i>Do you believe what he says?</i>"
);

// B2: Unformatted line (no data-anki-fmt) — left roman
assert(
  "Unformatted line — content stays roman on unwrap",
  unwrap("{{c1::Some roman text::hint}}", undefined),
  "Some roman text"
);

// B3: Cloze without hint
assert(
  "Cloze without hint — re-italicised",
  unwrap("&nbsp;&nbsp;&nbsp;&nbsp;{{c1::No hint here}}", "1"),
  "&nbsp;&nbsp;&nbsp;&nbsp;<i>No hint here</i>"
);

// B4: Cloze without hint, unformatted
assert(
  "Cloze without hint, unformatted — stays roman",
  unwrap("{{c1::No hint here}}", undefined),
  "No hint here"
);

// B5: Parenthetical content after cloze is preserved
assert(
  "Parenthetical after cloze preserved",
  unwrap(
    '&nbsp;&nbsp;&nbsp;&nbsp;{{c1::Do you believe what he says?::hint}}&nbsp;(not&nbsp;<span class="del">Are you believing</span>...?)',
    "1"
  ),
  '&nbsp;&nbsp;&nbsp;&nbsp;<i>Do you believe what he says?</i>&nbsp;(not&nbsp;<span class="del">Are you believing</span>...?)'
);

// B6: Multiple clozes on the same line (shouldn't happen normally, but defensive)
assert(
  "Multiple clozes — all re-italicised",
  unwrap("{{c1::first::h1}} and {{c2::second::h2}}", "1"),
  "<i>first</i> and <i>second</i>"
);

// B7: data-anki-fmt explicitly not "1"
assert(
  "data-anki-fmt='0' — stays roman",
  unwrap("{{c1::text::hint}}", "0"),
  "text"
);

// =============================================================
// C) ROUND-TRIP INTEGRITY — Format → Wrap → Unwrap
// =============================================================
console.log("\n━━━ Part C: Round-trip integrity ━━━\n");

// Simulate: formatted line → aiGetText strips <i> → cloze created → unwrap re-adds <i>
const originalFormatted = "<i>The tank contains about 7,000 litres at the moment.</i>";
const afterClozeWrap = stripItalic(originalFormatted); // simulates aiGetText
const clozeHTML = `&nbsp;&nbsp;&nbsp;&nbsp;{{c1::${afterClozeWrap}::hint}}`;
const afterUnwrap = unwrap(clozeHTML, "1"); // simulates unwrapCloze with data-anki-fmt="1"

assert(
  "Round-trip: format → wrap (roman) → unwrap restores italic",
  afterUnwrap,
  "&nbsp;&nbsp;&nbsp;&nbsp;<i>The tank contains about 7,000 litres at the moment.</i>"
);

// Verify the cloze itself is roman (no <i>)
assert(
  "Cloze content is roman (no <i> tags inside markers)",
  clozeHTML.includes("<i>"),
  false
);

// Round-trip with .del span in parenthetical
const formattedWithDel =
  '<i>I like this wine.</i>&nbsp;(not&nbsp;<span class="del" style="font-style: italic;">I\'m liking this wine.</span>)';
const mainSentence = "<i>I like this wine.</i>"; // targetHTML after split
const leftover =
  '&nbsp;(not&nbsp;<span class="del" style="font-style: italic;">I\'m liking this wine.</span>)';
const clozeMain = stripItalic(mainSentence);
const fullCloze = `&nbsp;&nbsp;&nbsp;&nbsp;{{c1::${clozeMain}::hint}}${leftover}`;
const fullUnwrap = unwrap(fullCloze, "1");

assert(
  "Round-trip with .del: cloze content is roman",
  fullCloze.match(/\{\{c1::(.*?)::hint\}\}/)[1].includes("<i>"),
  false
);

assert(
  "Round-trip with .del: unwrap restores italic + preserves .del",
  fullUnwrap,
  '&nbsp;&nbsp;&nbsp;&nbsp;<i>I like this wine.</i>&nbsp;(not&nbsp;<span class="del" style="font-style: italic;">I\'m liking this wine.</span>)'
);

// =============================================================
// SUMMARY
// =============================================================
console.log(`\n${"━".repeat(50)}`);
console.log(
  `  ${passed + failed} tests: ${passed} passed, ${failed} failed`
);
console.log("━".repeat(50));
process.exit(failed > 0 ? 1 : 0);
