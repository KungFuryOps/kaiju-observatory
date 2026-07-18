import assert from "node:assert/strict";
import test from "node:test";
import {
  hrefShape,
  summarizeEntryDetail,
  summarizeProfileCorrelation,
  summarizeRankingEntries,
} from "./inspect-rankings.js";

test("summarizes ranking entries without exposing identities or route names", () => {
  const html = `
    <table>
      <tr><th>Rank</th><th>Participant</th><th>Score</th></tr>
      <tr><td>1</td><td><a href="entry?id=123">ALICE EXAMPLE STONE</a></td><td>100</td></tr>
      <tr><td>2</td><td><a href="entry?id=124">ALICE EXAMPLE STONE</a></td><td>90</td></tr>
      <tr><td>3</td><td onclick="openEntry(900)">BOB NORTH</td><td>80</td></tr>
    </table>
  `;

  const result = summarizeRankingEntries(html);
  assert.equal(result.firstFollowableHref, "entry?id=123");
  assert.deepEqual(result.summary, {
    rows: 3,
    nameWordCounts: { one: 0, two: 1, three: 2, fourOrMore: 0 },
    duplicateNormalizedNames: 1,
    cellsWithLinks: 2,
    cellsWithOnclick: 1,
    hrefShapes: ["/[SEGMENT]?p1=[NUMBER]"],
    onclickShapes: ["[CALL]([REDACTED])"],
    descendantTags: ["a", "td"],
    attributeNames: ["href", "onclick"],
  });

  const serialized = JSON.stringify(result.summary);
  assert.doesNotMatch(serialized, /ALICE|BOB|entry|openEntry|id/i);
});

test("summarizes an entry page while redacting fields, labels, and links", () => {
  const html = `
    <html>
      <head><title>Private-looking title</title></head>
      <body>
        <form method="post" action="search">
          <input name="person" value="ALICE EXAMPLE STONE" maxlength="80">
          <select name="season"><option value="2026" selected>Current season</option></select>
        </form>
        <table>
          <tr><th>Date</th><th>Record</th></tr>
          <tr><td>01/07/2026</td><td><a href="result?event=42&match=7&group=9">View</a></td></tr>
        </table>
      </body>
    </html>
  `;

  const summary = summarizeEntryDetail(html);
  assert.equal(summary.titleLength, 21);
  assert.deepEqual(summary.yearsMentioned, [2026]);
  assert.equal(summary.dateOccurrences, 1);
  assert.deepEqual(summary.forms[0], {
    index: 0,
    method: "POST",
    actionShape: "/[SEGMENT]",
    inputs: [{ type: "text", valueShape: "[TEXT]", maxLength: 80 }],
    selects: [{ optionCount: 1, selectedCount: 1, valueShapes: { "[NUMBER]": 1 } }],
  });
  assert.ok(summary.hrefShapes.some(
    (link) => link.hrefShape === "/[SEGMENT]?p1=[NUMBER]&p2=[NUMBER]&p3=[NUMBER]" && link.count === 1,
  ));

  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /ALICE|Current season|person|search|result|event|match|group/i);
});

test("correlates source identities across profiles without exposing raw values", () => {
  const profileHtml = {
    "series-a": `
      <table>
        <tr><th>Rank</th><th>Participant</th><th>Score</th></tr>
        <tr><td>1</td><td><a href="entry?id=101">ALICE EXAMPLE</a></td><td>10</td></tr>
        <tr><td>2</td><td><a href="entry?id=201">DUPLICATE PERSON</a></td><td>9</td></tr>
        <tr><td>3</td><td><a href="entry?id=202">DUPLICATE PERSON</a></td><td>8</td></tr>
        <tr><td>4</td><td>ONLY LEFT</td><td>7</td></tr>
      </table>
    `,
    "series-b": `
      <table>
        <tr><th>Rank</th><th>Participant</th><th>Score</th></tr>
        <tr><td>1</td><td><a href="member?id=101">ALICE EXAMPLE</a></td><td>10</td></tr>
        <tr><td>2</td><td><a href="member?id=203">DUPLICATE PERSON</a></td><td>9</td></tr>
        <tr><td>3</td><td><a href="member?id=202">BOB EXAMPLE</a></td><td>8</td></tr>
      </table>
    `,
  };

  const summary = summarizeProfileCorrelation(profileHtml);
  assert.deepEqual(summary, {
    profiles: {
      "series-a": {
        rows: 4,
        distinctNames: 3,
        distinctSourceIds: 3,
        distinctSourceRecords: 3,
        rowsWithoutSourceId: 1,
        duplicateNameGroups: 1,
        namesWithMultipleSourceIds: 1,
        sourceIdsWithMultipleNames: 0,
      },
      "series-b": {
        rows: 3,
        distinctNames: 3,
        distinctSourceIds: 3,
        distinctSourceRecords: 3,
        rowsWithoutSourceId: 0,
        duplicateNameGroups: 0,
        namesWithMultipleSourceIds: 0,
        sourceIdsWithMultipleNames: 0,
      },
    },
    pairs: [{
      left: "series-a",
      right: "series-b",
      sharedNames: 2,
      sharedSourceIds: 2,
      sharedSourceRecords: 0,
      sharedNameAndSourceIdPairs: 1,
      sharedNamesWithoutCommonSourceId: 1,
      sharedSourceIdsWithoutCommonName: 1,
    }],
  });
  assert.doesNotMatch(
    JSON.stringify(summary),
    /ALICE EXAMPLE|BOB EXAMPLE|DUPLICATE PERSON|"entry"|"member"|101|201|202|203/i,
  );
});

test("classifies external URLs and redacts path and script identifiers", () => {
  assert.equal(hrefShape("https://example.org/private?id=1"), "[EXTERNAL_URL]");
  assert.equal(hrefShape("/participants/123"), "/[SEGMENT]/[NUMBER]");
  assert.equal(hrefShape("javascript:openEntry('ALICE', 123)"), "javascript:[CALL]([REDACTED])");
});
